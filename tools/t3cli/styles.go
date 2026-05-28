package main

import "github.com/charmbracelet/lipgloss"

var (
	userStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("10")).Bold(true)
	dimStyle     = lipgloss.NewStyle().Faint(true)
	toolStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("6"))
	errorStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("9"))
	successStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("2"))
	warnStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("11"))
	statusStyle  = lipgloss.NewStyle().Foreground(lipgloss.Color("7")).Faint(true)
	promptStyle  = lipgloss.NewStyle().Foreground(lipgloss.Color("10"))
	spinnerStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("6"))
)

const (
	successMark = "✓"
	errorMark   = "✗"
)
