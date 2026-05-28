package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/bmatcuk/doublestar/v4"
)

const maxToolOutput = 12_000

func executeTool(call toolCall, cwd string) toolResult {
	switch call.Name {
	case "read_file":
		return toolReadFile(call.Input, cwd)
	case "write_file":
		return toolWriteFile(call.Input, cwd)
	case "edit_file":
		return toolEditFile(call.Input, cwd)
	case "run_command":
		return toolRunCommand(call.Input, cwd)
	case "glob":
		return toolGlob(call.Input, cwd)
	case "grep":
		return toolGrep(call.Input, cwd)
	default:
		return toolResult{Name: call.Name, Status: "error", Output: "Unknown tool: " + call.Name}
	}
}

func resolvePath(p, cwd string) string {
	if filepath.IsAbs(p) {
		return p
	}
	return filepath.Join(cwd, p)
}

func truncate(s string) string {
	if len(s) <= maxToolOutput {
		return s
	}
	return s[:maxToolOutput] + fmt.Sprintf("\n... (truncated, %d chars omitted)", len(s)-maxToolOutput)
}

func inputStr(m map[string]any, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func inputInt(m map[string]any, key string, fallback int) int {
	switch n := m[key].(type) {
	case float64:
		return int(n)
	case int:
		return n
	case string:
		if i, err := strconv.Atoi(n); err == nil {
			return i
		}
	}
	return fallback
}

func toolReadFile(input map[string]any, cwd string) toolResult {
	path := resolvePath(inputStr(input, "path"), cwd)
	data, err := os.ReadFile(path)
	if err != nil {
		return toolResult{Name: "read_file", Status: "error", Output: err.Error()}
	}
	lines := strings.Split(string(data), "\n")

	offset := inputInt(input, "offset", 0)
	limit := inputInt(input, "limit", len(lines))

	end := offset + limit
	if end > len(lines) {
		end = len(lines)
	}
	if offset >= len(lines) {
		return toolResult{Name: "read_file", Status: "error", Output: "offset beyond end of file"}
	}

	var sb strings.Builder
	for i := offset; i < end; i++ {
		fmt.Fprintf(&sb, "%d\t%s\n", i+1, lines[i])
	}
	return toolResult{Name: "read_file", Status: "success", Output: truncate(sb.String())}
}

func toolWriteFile(input map[string]any, cwd string) toolResult {
	path := resolvePath(inputStr(input, "path"), cwd)
	content := inputStr(input, "content")

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return toolResult{Name: "write_file", Status: "error", Output: err.Error()}
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return toolResult{Name: "write_file", Status: "error", Output: err.Error()}
	}
	return toolResult{Name: "write_file", Status: "success", Output: fmt.Sprintf("Wrote %d bytes to %s", len(content), path)}
}

func toolEditFile(input map[string]any, cwd string) toolResult {
	path := resolvePath(inputStr(input, "path"), cwd)
	oldStr := inputStr(input, "old_string")
	newStr := inputStr(input, "new_string")

	data, err := os.ReadFile(path)
	if err != nil {
		return toolResult{Name: "edit_file", Status: "error", Output: err.Error()}
	}

	content := string(data)
	idx := strings.Index(content, oldStr)
	if idx == -1 {
		return toolResult{Name: "edit_file", Status: "error", Output: "old_string not found in " + path}
	}
	if strings.LastIndex(content, oldStr) != idx {
		return toolResult{Name: "edit_file", Status: "error", Output: "old_string appears multiple times — provide more context to make it unique"}
	}

	updated := content[:idx] + newStr + content[idx+len(oldStr):]
	if err := os.WriteFile(path, []byte(updated), 0o644); err != nil {
		return toolResult{Name: "edit_file", Status: "error", Output: err.Error()}
	}
	return toolResult{Name: "edit_file", Status: "success", Output: "Edited " + path}
}

func toolRunCommand(input map[string]any, cwd string) toolResult {
	command := inputStr(input, "command")
	timeout := time.Duration(inputInt(input, "timeout", 30000)) * time.Millisecond

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "sh", "-c", command)
	cmd.Dir = cwd
	cmd.Env = os.Environ()
	out, err := cmd.CombinedOutput()

	exitCode := 0
	if cmd.ProcessState != nil {
		exitCode = cmd.ProcessState.ExitCode()
	}

	output := string(out)
	if err != nil && exitCode == 0 {
		output += "\nerror: " + err.Error()
		exitCode = 1
	}
	output += fmt.Sprintf("\nexit code: %d", exitCode)

	status := "success"
	if exitCode != 0 {
		status = "error"
	}
	return toolResult{Name: "run_command", Status: status, Output: truncate(output)}
}

func toolGlob(input map[string]any, cwd string) toolResult {
	pattern := inputStr(input, "pattern")
	basePath := cwd
	if p := inputStr(input, "path"); p != "" {
		basePath = resolvePath(p, cwd)
	}

	fsys := os.DirFS(basePath)
	matches, err := doublestar.Glob(fsys, pattern)
	if err != nil {
		return toolResult{Name: "glob", Status: "error", Output: err.Error()}
	}

	var filtered []string
	for _, m := range matches {
		if strings.Contains(m, "node_modules/") || strings.Contains(m, ".git/") {
			continue
		}
		filtered = append(filtered, m)
		if len(filtered) >= 500 {
			break
		}
	}

	if len(filtered) == 0 {
		return toolResult{Name: "glob", Status: "success", Output: "No files matched."}
	}
	return toolResult{Name: "glob", Status: "success", Output: truncate(strings.Join(filtered, "\n"))}
}

func toolGrep(input map[string]any, cwd string) toolResult {
	pattern := inputStr(input, "pattern")
	path := cwd
	if p := inputStr(input, "path"); p != "" {
		path = resolvePath(p, cwd)
	}

	args := []string{"-rn", "--color=never", "--no-heading"}
	if g := inputStr(input, "glob"); g != "" {
		args = append(args, "--glob", g)
	}
	if c := inputInt(input, "context", 0); c > 0 {
		args = append(args, fmt.Sprintf("-C%d", c))
	}
	args = append(args, pattern, path)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "rg", args...)
	out, _ := cmd.CombinedOutput()
	exitCode := 0
	if cmd.ProcessState != nil {
		exitCode = cmd.ProcessState.ExitCode()
	}

	if exitCode == 1 && len(strings.TrimSpace(string(out))) == 0 {
		return toolResult{Name: "grep", Status: "success", Output: "No matches found."}
	}
	if exitCode > 1 {
		return toolResult{Name: "grep", Status: "error", Output: strings.TrimSpace(string(out))}
	}
	return toolResult{Name: "grep", Status: "success", Output: truncate(string(out))}
}
