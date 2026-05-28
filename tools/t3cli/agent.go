package main

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

func buildSystemPrompt(cwd string) string {
	return fmt.Sprintf(`You are an AI coding assistant with direct access to the local filesystem and shell. You help users understand, modify, and create code.

Current working directory: %s

# Tools

To use a tool, write a <tool_call> block containing a JSON object. You may use multiple tool calls in one response. After your tool calls, STOP writing and wait for results.

## read_file
Read a file. Params: path (required), limit (optional max lines), offset (optional start line).
<tool_call>
{"name": "read_file", "input": {"path": "%s/example.ts"}}
</tool_call>

## write_file
Create or overwrite a file. Params: path, content (both required).
<tool_call>
{"name": "write_file", "input": {"path": "%s/new.ts", "content": "export const x = 1;\n"}}
</tool_call>

## edit_file
Replace a specific string in a file. old_string must match exactly including whitespace. Params: path, old_string, new_string.
<tool_call>
{"name": "edit_file", "input": {"path": "%s/example.ts", "old_string": "const x = 1", "new_string": "const x = 2"}}
</tool_call>

## run_command
Execute a shell command. Params: command (required), timeout (optional ms, default 30000).
<tool_call>
{"name": "run_command", "input": {"command": "ls -la src/"}}
</tool_call>

## glob
Find files matching a glob pattern. Params: pattern (required), path (optional base dir).
<tool_call>
{"name": "glob", "input": {"pattern": "**/*.ts"}}
</tool_call>

## grep
Search for a regex pattern in files. Params: pattern (required), path (optional dir), glob (optional file filter), context (optional context lines).
<tool_call>
{"name": "grep", "input": {"pattern": "function handleRequest", "glob": "*.ts"}}
</tool_call>

# Guidelines
- Use absolute paths.
- Read files before editing them.
- Be concise — explain briefly what you're doing, then act.
- After tool calls, STOP and wait for results before continuing.
- When a task is complete, say so clearly.
- Do NOT wrap tool_call blocks in markdown code fences.`, cwd, cwd, cwd, cwd)
}

type toolCall struct {
	Name  string         `json:"name"`
	Input map[string]any `json:"input"`
}

type toolResult struct {
	Name   string
	Status string
	Output string
}

var toolCallRe = regexp.MustCompile(`(?s)<tool_call>\s*(.*?)\s*</tool_call>`)

func parseToolCalls(text string) []toolCall {
	matches := toolCallRe.FindAllStringSubmatch(text, -1)
	var calls []toolCall
	for _, m := range matches {
		var tc toolCall
		if err := json.Unmarshal([]byte(m[1]), &tc); err == nil && tc.Name != "" {
			calls = append(calls, tc)
		}
	}
	return calls
}

func formatToolResults(results []toolResult) string {
	var sb strings.Builder
	for i, r := range results {
		if i > 0 {
			sb.WriteString("\n\n")
		}
		fmt.Fprintf(&sb, "<tool_result name=%q status=%q>\n%s\n</tool_result>", r.Name, r.Status, r.Output)
	}
	return sb.String()
}

func stripToolCalls(text string) string {
	return strings.TrimSpace(toolCallRe.ReplaceAllString(text, ""))
}

func toolTarget(tc toolCall) string {
	switch tc.Name {
	case "read_file", "write_file", "edit_file":
		if p, ok := tc.Input["path"].(string); ok {
			return p
		}
	case "run_command":
		if c, ok := tc.Input["command"].(string); ok {
			return c
		}
	case "glob":
		if p, ok := tc.Input["pattern"].(string); ok {
			return p
		}
	case "grep":
		if p, ok := tc.Input["pattern"].(string); ok {
			return p
		}
	}
	return ""
}

func newUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
