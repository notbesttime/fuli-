package service

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
)

func setupAILogDir(t *testing.T) {
	t.Helper()
	previous := config.Cfg
	t.Cleanup(func() { config.Cfg = previous })
	config.Cfg.AILogDir = t.TempDir()
}

func writeAILogFile(t *testing.T, date string, items []model.AICallLog) {
	t.Helper()
	lines := make([]string, 0, len(items))
	for _, item := range items {
		encoded, err := json.Marshal(item)
		if err != nil {
			t.Fatalf("marshal ai call log: %v", err)
		}
		lines = append(lines, string(encoded))
	}
	path := filepath.Join(config.Cfg.AILogDir, "ai-calls-"+date+".log")
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		t.Fatalf("write ai log file: %v", err)
	}
}

func seedAILogs(t *testing.T) {
	t.Helper()
	writeAILogFile(t, "2026-11-10", []model.AICallLog{
		{ID: "l1", UserID: "u1", UserDisplayName: "alice", Endpoint: "/v1/images/generations", Method: "POST", Model: "gpt-image-1", ChannelID: "c1", ChannelName: "主渠道", Status: 200, DurationMs: 1000, Credits: 1.5, CreatedAt: "2026-11-10T10:00:00+08:00"},
		{ID: "l2", UserID: "u2", UserDisplayName: "bob", Endpoint: "/v1/images/generations", Method: "POST", Model: "gpt-image-1", ChannelID: "c1", ChannelName: "主渠道", Status: 200, DurationMs: 3000, Credits: 2, CreatedAt: "2026-11-10T11:00:00+08:00"},
	})
	writeAILogFile(t, "2026-11-12", []model.AICallLog{
		{ID: "l3", UserID: "u1", UserDisplayName: "alice", Endpoint: "/v1/chat/completions", Method: "POST", Model: "gpt-4o-mini", ChannelID: "c2", ChannelName: "备用渠道", Status: 502, Failed: true, Error: "upstream 502", DurationMs: 2000, CreatedAt: "2026-11-12T09:00:00+08:00"},
	})
}

func almostEqual(a, b float64) bool {
	return math.Abs(a-b) < 1e-9
}

func TestAICallLogStatsAggregates(t *testing.T) {
	setupAILogDir(t)
	seedAILogs(t)

	stats, err := AICallLogStats(model.Query{})
	if err != nil {
		t.Fatalf("AICallLogStats returned error: %v", err)
	}
	if stats.Total != 3 || stats.Success != 2 || stats.Failed != 1 {
		t.Fatalf("counts = total:%d success:%d failed:%d, want 3/2/1", stats.Total, stats.Success, stats.Failed)
	}
	if !almostEqual(stats.FailureRate, 0.3333) {
		t.Fatalf("failureRate = %v, want 0.3333", stats.FailureRate)
	}
	if !almostEqual(stats.AvgDurationMs, 2000) {
		t.Fatalf("avgDurationMs = %v, want 2000", stats.AvgDurationMs)
	}
	if stats.P95DurationMs != 3000 {
		t.Fatalf("p95DurationMs = %d, want 3000", stats.P95DurationMs)
	}
	if !almostEqual(stats.Credits, 3.5) {
		t.Fatalf("credits = %v, want 3.5", stats.Credits)
	}
	if stats.UserCount != 2 || stats.ModelCount != 2 || stats.ChannelCount != 2 {
		t.Fatalf("distinct counts = users:%d models:%d channels:%d, want 2/2/2", stats.UserCount, stats.ModelCount, stats.ChannelCount)
	}
	if len(stats.Daily) != 2 {
		t.Fatalf("daily len = %d, want 2", len(stats.Daily))
	}
	if first := stats.Daily[0]; first.Date != "2026-11-10" || first.Calls != 2 || first.Failed != 0 || !almostEqual(first.Credits, 3.5) {
		t.Fatalf("daily[0] = %#v, want 2026-11-10 calls 2 failed 0 credits 3.5", first)
	}
	if len(stats.ByModel) != 2 || stats.ByModel[0].Key != "gpt-image-1" || stats.ByModel[0].Calls != 2 {
		t.Fatalf("byModel = %#v, want gpt-image-1 first with 2 calls", stats.ByModel)
	}
	if len(stats.ByUser) != 2 || stats.ByUser[0].Key != "alice" || stats.ByUser[0].Calls != 2 || stats.ByUser[0].Failed != 1 {
		t.Fatalf("byUser = %#v, want alice first with 2 calls 1 failed", stats.ByUser)
	}
	if len(stats.ByChannel) != 2 || stats.ByChannel[0].Key != "主渠道" || stats.ByChannel[0].Calls != 2 {
		t.Fatalf("byChannel = %#v, want 主渠道 first with 2 calls", stats.ByChannel)
	}
	if len(stats.Models) != 2 || stats.Models[0] != "gpt-4o-mini" || stats.Models[1] != "gpt-image-1" {
		t.Fatalf("models = %#v, want sorted distinct models", stats.Models)
	}
}

func TestListAICallLogsFilters(t *testing.T) {
	setupAILogDir(t)
	seedAILogs(t)

	cases := []struct {
		name string
		q    model.Query
		want int
	}{
		{"all", model.Query{}, 3},
		{"model", model.Query{Model: "gpt-4o-mini"}, 1},
		{"channelName", model.Query{Channel: "主渠道"}, 2},
		{"channelID", model.Query{Channel: "c2"}, 1},
		{"failed", model.Query{Result: "failed"}, 1},
		{"success", model.Query{Result: "success"}, 2},
		{"keyword", model.Query{Keyword: "alice"}, 2},
		{"range", model.Query{StartDate: "2026-11-11", EndDate: "2026-11-12"}, 1},
		{"rangeOpen", model.Query{StartDate: "2026-11-11"}, 1},
		{"rangeInvalid", model.Query{StartDate: "not-a-date"}, 3},
	}
	for _, testCase := range cases {
		list, err := ListAICallLogs(testCase.q)
		if err != nil {
			t.Fatalf("%s: ListAICallLogs returned error: %v", testCase.name, err)
		}
		if list.Total != testCase.want {
			t.Fatalf("%s: total = %d, want %d", testCase.name, list.Total, testCase.want)
		}
	}
}

func TestAICallLogStatsDateRangeKeepsOptions(t *testing.T) {
	setupAILogDir(t)
	seedAILogs(t)

	stats, err := AICallLogStats(model.Query{StartDate: "2026-11-11", EndDate: "2026-11-12"})
	if err != nil {
		t.Fatalf("AICallLogStats returned error: %v", err)
	}
	if stats.Total != 1 || stats.Failed != 1 {
		t.Fatalf("counts = total:%d failed:%d, want 1/1", stats.Total, stats.Failed)
	}
	if len(stats.Models) != 1 || stats.Models[0] != "gpt-4o-mini" {
		t.Fatalf("models = %#v, want only gpt-4o-mini in range", stats.Models)
	}
	if len(stats.Channels) != 1 || stats.Channels[0] != "备用渠道" {
		t.Fatalf("channels = %#v, want only 备用渠道 in range", stats.Channels)
	}
}

func TestExportAICallLogsCSV(t *testing.T) {
	setupAILogDir(t)
	seedAILogs(t)

	exported, err := ExportAICallLogs(model.Query{})
	if err != nil {
		t.Fatalf("ExportAICallLogs returned error: %v", err)
	}
	if exported.Total != 3 || exported.Truncated {
		t.Fatalf("total = %d truncated = %v, want 3/false", exported.Total, exported.Truncated)
	}
	if !strings.HasSuffix(exported.FileName, ".csv") {
		t.Fatalf("fileName = %q, want .csv suffix", exported.FileName)
	}
	if !strings.HasPrefix(exported.Content, "\ufeff") {
		t.Fatal("csv content should start with BOM")
	}
	lines := strings.Split(strings.TrimSpace(strings.TrimPrefix(exported.Content, "\ufeff")), "\n")
	if len(lines) != 4 {
		t.Fatalf("csv lines = %d, want header + 3 rows", len(lines))
	}
	if !strings.Contains(lines[0], "时间") || !strings.Contains(lines[0], "模型") || !strings.Contains(lines[0], "结果") {
		t.Fatalf("csv header = %q, want chinese headers", lines[0])
	}
	if !strings.Contains(exported.Content, "失败") || !strings.Contains(exported.Content, "成功") {
		t.Fatal("csv should contain both 成功 and 失败 rows")
	}
}

func TestExportAICallLogsEscapesFormulaCells(t *testing.T) {
	setupAILogDir(t)
	writeAILogFile(t, "2026-11-13", []model.AICallLog{
		{ID: "x1", UserID: "u1", UserDisplayName: "carol", Endpoint: "/v1/images/generations", Method: "POST", Model: "gpt-image-1", ChannelID: "c1", ChannelName: "主渠道", Status: 500, Failed: true, Error: "=1+1", CreatedAt: "2026-11-13T10:00:00+08:00"},
	})

	exported, err := ExportAICallLogs(model.Query{})
	if err != nil {
		t.Fatalf("ExportAICallLogs returned error: %v", err)
	}
	if !strings.Contains(exported.Content, "'=1+1") {
		t.Fatalf("csv content = %q, want formula cell escaped", exported.Content)
	}
}
