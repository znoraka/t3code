package main

import (
	"context"
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
)

type appState int

const (
	stateInit appState = iota
	stateReady
	stateStreaming
	stateConfirming
	stateExecuting
	stateModelPicker
)

const maxToolRounds = 25

// --- Messages ---

type bridgeReadyMsg struct{ b *bridge }
type bridgeErrMsg struct{ err error }

type streamMsg struct {
	delta *chatDelta
	done  bool
	err   error
}

type toolsDoneMsg struct {
	calls   []toolCall
	results []toolResult
}

type modelsFetchedMsg struct {
	models []modelInfo
	err    error
}

// --- Model ---

type model struct {
	state    appState
	cfg      config
	bridge   *bridge
	fatalErr error

	messages   []chatMessage
	history    strings.Builder
	streamText strings.Builder
	reasonText strings.Builder
	streamCh   <-chan streamMsg
	cancelFn   context.CancelFunc
	toolRound  int
	pending    []toolCall

	pickerModels []modelInfo
	pickerCursor int

	vp      viewport.Model
	input   textinput.Model
	spin    spinner.Model
	width   int
	height  int
	vpReady bool
}

func newModel(cfg config) *model {
	ti := textinput.New()
	ti.Placeholder = "Type your message..."
	ti.Prompt = "> "
	ti.PromptStyle = promptStyle
	ti.CharLimit = 0

	sp := spinner.New()
	sp.Spinner = spinner.Dot
	sp.Style = spinnerStyle

	m := &model{
		state: stateInit,
		cfg:   cfg,
		input: ti,
		spin:  sp,
	}

	m.messages = []chatMessage{
		{ID: newUUID(), Role: "user", Content: buildSystemPrompt(cfg.cwd)},
		{ID: newUUID(), Role: "assistant", Content: "Understood. I have access to read_file, write_file, edit_file, run_command, glob, and grep. What would you like to do?"},
	}

	m.history.WriteString(dimStyle.Render("t3cli — lite coding agent via t3.chat") + "\n")
	m.history.WriteString(dimStyle.Render(fmt.Sprintf("Model: %s | Effort: %s", cfg.model, cfg.effort)) + "\n")
	if cfg.yolo {
		m.history.WriteString(warnStyle.Render("YOLO mode: tools auto-approved") + "\n")
	}
	m.history.WriteString("\n")

	return m
}

func (m *model) Init() tea.Cmd {
	cfg := m.cfg
	return tea.Batch(
		m.spin.Tick,
		func() tea.Msg {
			b, err := spawnBridge(cfg)
			if err != nil {
				return bridgeErrMsg{err}
			}
			return bridgeReadyMsg{b}
		},
	)
}

func (m *model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		h := msg.Height - 3
		if h < 1 {
			h = 1
		}
		if !m.vpReady {
			m.vp = viewport.New(msg.Width, h)
			m.vp.SetContent(m.history.String())
			m.vpReady = true
		} else {
			m.vp.Width = msg.Width
			m.vp.Height = h
		}
		w := msg.Width - 4
		if w < 10 {
			w = 10
		}
		m.input.Width = w
		return m, nil

	case tea.KeyMsg:
		return m.handleKey(msg)

	case bridgeReadyMsg:
		m.bridge = msg.b
		m.state = stateReady
		m.input.Focus()
		m.appendHist(dimStyle.Render("Bridge connected.") + "\n\n")
		if m.cfg.initialPrompt != "" {
			m.input.SetValue(m.cfg.initialPrompt)
			return m.submit()
		}
		return m, nil

	case bridgeErrMsg:
		m.fatalErr = msg.err
		return m, tea.Quit

	case streamMsg:
		return m.handleStream(msg)

	case toolsDoneMsg:
		return m.handleToolsDone(msg)

	case modelsFetchedMsg:
		if msg.err != nil {
			m.pickerModels = fallbackModels
		} else {
			m.pickerModels = msg.models
		}
		for i, mi := range m.pickerModels {
			if mi.ID == m.cfg.model {
				m.pickerCursor = i
				break
			}
		}
		m.refreshVP()
		return m, nil

	case spinner.TickMsg:
		if m.state == stateReady {
			return m, nil
		}
		var cmd tea.Cmd
		m.spin, cmd = m.spin.Update(msg)
		return m, cmd
	}

	var cmd tea.Cmd
	m.vp, cmd = m.vp.Update(msg)
	return m, cmd
}

func (m *model) handleKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if msg.String() == "ctrl+c" {
		return m, tea.Quit
	}

	if m.state == stateModelPicker {
		return m.handlePickerKey(msg)
	}

	switch msg.String() {
	case "enter":
		if m.state == stateReady && strings.TrimSpace(m.input.Value()) != "" {
			return m.submit()
		}
		if m.state == stateConfirming {
			return m.confirmTools(true)
		}

	case "esc":
		if m.state == stateStreaming && m.cancelFn != nil {
			m.cancelFn()
			m.cancelFn = nil
			m.appendHist(dimStyle.Render("(cancelled)") + "\n\n")
			m.finishTurn()
			return m, nil
		}

	case "y", "Y":
		if m.state == stateConfirming {
			return m.confirmTools(true)
		}

	case "n", "N":
		if m.state == stateConfirming {
			return m.confirmTools(false)
		}
	}

	if m.state == stateReady {
		var cmd tea.Cmd
		m.input, cmd = m.input.Update(msg)
		return m, cmd
	}
	return m, nil
}

func (m *model) handlePickerKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "up", "k":
		if m.pickerCursor > 0 {
			m.pickerCursor--
			m.refreshVP()
		}
	case "down", "j":
		if len(m.pickerModels) > 0 && m.pickerCursor < len(m.pickerModels)-1 {
			m.pickerCursor++
			m.refreshVP()
		}
	case "enter":
		if len(m.pickerModels) > 0 {
			selected := m.pickerModels[m.pickerCursor]
			m.cfg.model = selected.ID
			m.appendHist(dimStyle.Render(fmt.Sprintf("Model → %s", selected.ID)) + "\n\n")
		}
		m.finishTurn()
	case "esc":
		m.finishTurn()
	}
	return m, nil
}

func (m *model) handleStream(msg streamMsg) (tea.Model, tea.Cmd) {
	if m.state != stateStreaming {
		return m, nil
	}
	if msg.err != nil {
		m.appendHist(errorStyle.Render("Error: "+msg.err.Error()) + "\n\n")
		m.finishTurn()
		return m, nil
	}
	if msg.done {
		return m.streamDone()
	}
	if msg.delta != nil {
		if msg.delta.Kind == "reasoning" {
			m.reasonText.WriteString(msg.delta.Text)
		} else {
			m.streamText.WriteString(msg.delta.Text)
		}
		m.refreshVP()
	}
	return m, waitStream(m.streamCh)
}

func (m *model) handleToolsDone(msg toolsDoneMsg) (tea.Model, tea.Cmd) {
	for i, r := range msg.results {
		mark := successStyle.Render(successMark)
		if r.Status == "error" {
			mark = errorStyle.Render(errorMark)
		}
		target := toolTarget(msg.calls[i])
		line := "  " + toolStyle.Render(r.Name)
		if target != "" {
			line += " " + dimStyle.Render(target)
		}
		line += " " + mark
		m.appendHist(line + "\n")
	}
	m.appendHist("\n")

	resultText := formatToolResults(msg.results)
	m.messages = append(m.messages, chatMessage{
		ID: newUUID(), Role: "user", Content: resultText,
	})
	m.toolRound++

	return m.startStream()
}

// --- Actions ---

func (m *model) submit() (tea.Model, tea.Cmd) {
	text := strings.TrimSpace(m.input.Value())
	m.input.SetValue("")
	m.input.Blur()

	if text == "/clear" {
		m.messages = m.messages[:2]
		m.history.Reset()
		m.appendHist(dimStyle.Render("Conversation cleared.") + "\n\n")
		m.state = stateReady
		m.input.Focus()
		return m, nil
	}

	if text == "/model" || strings.HasPrefix(text, "/model ") {
		return m.handleModelCmd(text)
	}

	m.messages = append(m.messages, chatMessage{
		ID: newUUID(), Role: "user", Content: text,
	})
	m.appendHist(userStyle.Render("You") + " " + text + "\n\n")
	m.toolRound = 0

	return m.startStream()
}

func (m *model) handleModelCmd(text string) (tea.Model, tea.Cmd) {
	parts := strings.SplitN(text, " ", 2)
	if len(parts) == 2 && strings.TrimSpace(parts[1]) != "" {
		newModel := strings.TrimSpace(parts[1])
		m.cfg.model = newModel
		m.appendHist(dimStyle.Render(fmt.Sprintf("Model → %s", newModel)) + "\n\n")
		m.state = stateReady
		m.input.Focus()
		return m, nil
	}

	m.state = stateModelPicker
	m.input.Blur()
	m.pickerModels = nil
	m.pickerCursor = 0
	m.refreshVP()

	url := m.bridge.url
	return m, tea.Batch(func() tea.Msg {
		models, err := fetchModels(url)
		return modelsFetchedMsg{models, err}
	}, m.spin.Tick)
}

func (m *model) startStream() (tea.Model, tea.Cmd) {
	m.state = stateStreaming
	m.streamText.Reset()
	m.reasonText.Reset()

	msgCh := make(chan streamMsg, 100)
	ctx, cancel := context.WithCancel(context.Background())
	m.cancelFn = cancel
	m.streamCh = msgCh

	cfg := m.cfg
	msgs := make([]chatMessage, len(m.messages))
	copy(msgs, m.messages)
	url := m.bridge.url

	go func() {
		defer close(msgCh)
		deltaCh := make(chan chatDelta, 100)
		errCh := make(chan error, 1)

		go func() {
			defer close(deltaCh)
			errCh <- streamChat(ctx, url, msgs, cfg, deltaCh)
		}()

		for d := range deltaCh {
			msgCh <- streamMsg{delta: &chatDelta{Text: d.Text, Kind: d.Kind}}
		}
		if err := <-errCh; err != nil {
			if ctx.Err() == nil {
				msgCh <- streamMsg{err: err}
			}
			return
		}
		msgCh <- streamMsg{done: true}
	}()

	return m, tea.Batch(waitStream(msgCh), m.spin.Tick)
}

func waitStream(ch <-chan streamMsg) tea.Cmd {
	return func() tea.Msg {
		msg, ok := <-ch
		if !ok {
			return streamMsg{done: true}
		}
		return msg
	}
}

func (m *model) streamDone() (tea.Model, tea.Cmd) {
	fullText := m.streamText.String()
	m.messages = append(m.messages, chatMessage{
		ID: newUUID(), Role: "assistant", Content: fullText,
	})

	display := stripToolCalls(fullText)
	if display != "" {
		m.appendHist(display + "\n\n")
	}

	calls := parseToolCalls(fullText)
	if len(calls) > 0 && m.toolRound < maxToolRounds {
		m.pending = calls
		if m.cfg.yolo || allReadOnly(calls) {
			return m.execPending()
		}
		m.state = stateConfirming
		m.refreshVP()
		return m, nil
	}

	m.finishTurn()
	return m, nil
}

func allReadOnly(calls []toolCall) bool {
	for _, c := range calls {
		switch c.Name {
		case "read_file", "glob", "grep":
		default:
			return false
		}
	}
	return true
}

func (m *model) confirmTools(approved bool) (tea.Model, tea.Cmd) {
	if !approved {
		m.messages = append(m.messages, chatMessage{
			ID:      newUUID(),
			Role:    "user",
			Content: "<tool_result name=\"all\" status=\"error\">\nUser declined tool execution.\n</tool_result>",
		})
		m.appendHist(dimStyle.Render("  (declined)") + "\n\n")
		m.finishTurn()
		return m, nil
	}
	return m.execPending()
}

func (m *model) execPending() (tea.Model, tea.Cmd) {
	m.state = stateExecuting
	calls := m.pending
	m.pending = nil
	cwd := m.cfg.cwd

	cmd := func() tea.Msg {
		results := make([]toolResult, len(calls))
		for i, tc := range calls {
			results[i] = executeTool(tc, cwd)
		}
		return toolsDoneMsg{calls: calls, results: results}
	}
	return m, tea.Batch(tea.Cmd(cmd), m.spin.Tick)
}

func (m *model) finishTurn() {
	m.state = stateReady
	m.streamText.Reset()
	m.reasonText.Reset()
	m.cancelFn = nil
	m.pending = nil
	m.input.Focus()
	m.refreshVP()
}

// --- View helpers ---

func (m *model) appendHist(s string) {
	m.history.WriteString(s)
	m.refreshVP()
}

func (m *model) refreshVP() {
	if !m.vpReady {
		return
	}

	var b strings.Builder
	b.WriteString(m.history.String())

	if m.state == stateStreaming {
		if m.reasonText.Len() > 0 {
			b.WriteString(dimStyle.Render(m.reasonText.String()) + "\n")
		}
		text := stripToolCalls(m.streamText.String())
		if text != "" {
			b.WriteString(text)
		}
	}

	if m.state == stateModelPicker {
		if len(m.pickerModels) == 0 {
			b.WriteString(dimStyle.Render("  Loading models...") + "\n")
		} else {
			b.WriteString("Select model:\n\n")
			lastProvider := ""
			for i, mi := range m.pickerModels {
				if mi.Provider != lastProvider {
					if lastProvider != "" {
						b.WriteString("\n")
					}
					b.WriteString("  " + dimStyle.Render(mi.Provider) + "\n")
					lastProvider = mi.Provider
				}
				cursor := "    "
				id := mi.ID
				if i == m.pickerCursor {
					cursor = "  " + toolStyle.Render("▸ ")
					id = toolStyle.Render(mi.ID)
				}
				line := cursor + id
				if mi.ID == m.cfg.model {
					line += " " + dimStyle.Render("(current)")
				}
				b.WriteString(line + "\n")
			}
			b.WriteString("\n" + dimStyle.Render("  ↑/↓ navigate  enter select  esc cancel") + "\n")
		}
	}

	if m.state == stateConfirming && len(m.pending) > 0 {
		for _, tc := range m.pending {
			target := toolTarget(tc)
			line := "  " + toolStyle.Render(tc.Name)
			if target != "" {
				line += " " + dimStyle.Render(target)
			}
			b.WriteString(line + "\n")
		}
		b.WriteString("\n" + warnStyle.Render("Execute tools? [Y/n]") + "\n")
	}

	m.vp.SetContent(b.String())

	if m.state == stateModelPicker && len(m.pickerModels) > 0 {
		// Scroll to keep the cursor roughly centered
		cursorLine := m.pickerCursor + 4 // account for header lines
		lastProv := ""
		for i := 0; i <= m.pickerCursor; i++ {
			if m.pickerModels[i].Provider != lastProv {
				cursorLine++
				if lastProv != "" {
					cursorLine++ // blank line between groups
				}
				lastProv = m.pickerModels[i].Provider
			}
		}
		histLines := strings.Count(m.history.String(), "\n")
		target := histLines + cursorLine - m.vp.Height/2
		if target < 0 {
			target = 0
		}
		m.vp.SetYOffset(target)
	} else {
		m.vp.GotoBottom()
	}
}

func (m *model) View() string {
	if m.fatalErr != nil {
		return errorStyle.Render(fmt.Sprintf("\n  Fatal: %v\n", m.fatalErr))
	}
	if !m.vpReady {
		return fmt.Sprintf("\n  %s Starting...\n", m.spin.View())
	}

	var b strings.Builder
	b.WriteString(m.vp.View())
	b.WriteString("\n")

	switch m.state {
	case stateInit:
		b.WriteString(statusStyle.Render(m.spin.View() + " Connecting to bridge..."))
	case stateStreaming:
		b.WriteString(statusStyle.Render(m.spin.View()+" Generating... ") + dimStyle.Render("esc to cancel"))
	case stateExecuting:
		b.WriteString(statusStyle.Render(m.spin.View() + " Running tools..."))
	case stateModelPicker:
		if len(m.pickerModels) == 0 {
			b.WriteString(statusStyle.Render(m.spin.View() + " Loading models..."))
		} else {
			b.WriteString(statusStyle.Render("Select a model"))
		}
	case stateConfirming:
		b.WriteString(statusStyle.Render("Awaiting confirmation"))
	default:
		b.WriteString(statusStyle.Render(m.cfg.model) + " " + dimStyle.Render("/model /clear"))
	}
	b.WriteString("\n")

	if m.state == stateReady {
		b.WriteString(m.input.View())
	}

	return b.String()
}

func (m *model) cleanup() {
	if m.cancelFn != nil {
		m.cancelFn()
	}
	if m.bridge != nil {
		m.bridge.kill()
	}
}
