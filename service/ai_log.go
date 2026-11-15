package service

import (
	"bufio"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"html"
	"log"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
	"github.com/google/uuid"
	"github.com/robfig/cron/v3"
)

const (
	aiLogRequestTextLimit = 256 * 1024
	aiLogErrorTextLimit   = 16 * 1024
	aiLogScannerMax       = 16 * 1024 * 1024
	aiLogGroupLimit       = 20
	aiLogOptionLimit      = 200
	aiLogExportRowLimit   = 20000
	defaultAILogCron      = "0 3 * * *"
	defaultAILogRetention = 14
)

var (
	htmlTagPattern        = regexp.MustCompile(`(?s)<[^>]+>`)
	whitespacePattern     = regexp.MustCompile(`\s+`)
	longDataURLPattern    = regexp.MustCompile(`data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n]{512,}`)
	longBase64TextPattern = regexp.MustCompile(`"[A-Za-z0-9+/=]{512,}"`)

	aiLogCleanupCron *cron.Cron
	aiLogCleanupOnce sync.Once
	aiLogCleanupMu   sync.Mutex
)

type AICallLogInput struct {
	UserID          string `json:"userId"`
	UserDisplayName string `json:"userDisplayName"`
	Endpoint        string `json:"endpoint"`
	Method          string `json:"method"`
	Model           string `json:"model"`
	ChannelID       string `json:"channelId"`
	ChannelName     string `json:"channelName"`
	Status          int    `json:"status"`
	DurationMs      int64  `json:"durationMs"`
	Credits         float64 `json:"credits"`
	RequestBody     string `json:"requestBody"`
	ResponseBody    string `json:"responseBody"`
	Error           string `json:"error"`
	OutcomeKnown    bool   `json:"-"`
}

func SaveAICallLog(input AICallLogInput) {
	responseBody := normalizeAICallResponseLog(input.ResponseBody, input.Error)
	failed := strings.TrimSpace(input.Error) != ""
	failure := &failed
	if input.OutcomeKnown {
		failure = nil
	}
	errorText := normalizeAICallErrorLog(input.Error, input.ResponseBody, failure)
	item := model.AICallLog{
		ID:              uuid.NewString(),
		UserID:          strings.TrimSpace(input.UserID),
		UserDisplayName: strings.TrimSpace(input.UserDisplayName),
		Endpoint:        strings.TrimSpace(input.Endpoint),
		Method:          strings.TrimSpace(input.Method),
		Model:           strings.TrimSpace(input.Model),
		ChannelID:       strings.TrimSpace(input.ChannelID),
		ChannelName:     strings.TrimSpace(input.ChannelName),
		Status:          input.Status,
		Failed:          failed,
		DurationMs:      input.DurationMs,
		Credits:         normalizeCredits(input.Credits),
		RequestBody:     truncateLogText(input.RequestBody, aiLogRequestTextLimit),
		ResponseBody:    responseBody,
		Error:           truncateLogText(errorText, aiLogErrorTextLimit),
		CreatedAt:       now(),
	}
	if err := appendAICallLog(item); err != nil {
		log.Printf("write ai call log failed err=%v", err)
	}
}

func ListAICallLogs(q model.Query) (model.AICallLogList, error) {
	q.Normalize()
	items, err := readAICallLogs(aiLogFilterOf(q), true)
	if err != nil {
		return model.AICallLogList{}, err
	}
	sort.SliceStable(items, func(i, j int) bool {
		return items[i].CreatedAt > items[j].CreatedAt
	})
	total := len(items)
	start := q.Offset()
	if start >= total {
		return model.AICallLogList{Items: []model.AICallLog{}, Total: total}, nil
	}
	end := start + q.PageSize
	if end > total {
		end = total
	}
	return model.AICallLogList{Items: items[start:end], Total: total}, nil
}

func DeleteAICallLogsOlderThan(days int) (int, error) {
	if days <= 0 {
		days = 7
	}
	cutoff := time.Now().AddDate(0, 0, -days)
	files, err := aiLogFiles()
	if err != nil {
		return 0, err
	}
	removed := 0
	for _, file := range files {
		fileDate, ok := aiLogFileDate(file)
		if !ok || !fileDate.Before(startOfDay(cutoff)) {
			continue
		}
		if err := os.Remove(file); err != nil {
			return removed, err
		}
		removed++
	}
	return removed, nil
}

func StartAILogCleanupScheduler() {
	aiLogCleanupOnce.Do(func() {
		aiLogCleanupCron = cron.New()
		aiLogCleanupCron.Start()
	})
	RefreshAILogCleanupScheduler()
}

func RefreshAILogCleanupScheduler() {
	aiLogCleanupMu.Lock()
	defer aiLogCleanupMu.Unlock()
	if aiLogCleanupCron == nil {
		return
	}
	for _, entry := range aiLogCleanupCron.Entries() {
		aiLogCleanupCron.Remove(entry.ID)
	}
	settings, err := repository.GetSettings()
	if err != nil {
		log.Printf("load ai log cleanup setting failed err=%v", err)
		return
	}
	setting := normalizeAILogCleanupSetting(settings.Private.AILog.Cleanup)
	if setting.Enabled == nil || !*setting.Enabled {
		return
	}
	if _, err := aiLogCleanupCron.AddFunc(setting.Cron, func() {
		removed, err := DeleteAICallLogsOlderThan(setting.RetentionDays)
		if err != nil {
			log.Printf("scheduled ai log cleanup failed err=%v", err)
			return
		}
		log.Printf("scheduled ai log cleanup done removedFiles=%d retentionDays=%d", removed, setting.RetentionDays)
	}); err != nil {
		log.Printf("add ai log cleanup cron failed cron=%s err=%v", setting.Cron, err)
	}
}

func normalizeAILogCleanupSetting(setting model.AILogCleanupSetting) model.AILogCleanupSetting {
	if setting.Cron == "" {
		setting.Cron = defaultAILogCron
	}
	if setting.RetentionDays <= 0 {
		setting.RetentionDays = defaultAILogRetention
	}
	if setting.Enabled == nil {
		enabled := false
		setting.Enabled = &enabled
	}
	return setting
}

func normalizeAILogSetting(setting model.AILogSetting) model.AILogSetting {
	setting.Cleanup = normalizeAILogCleanupSetting(setting.Cleanup)
	if setting.LocalDirectReportEnabled == nil {
		enabled := false
		setting.LocalDirectReportEnabled = &enabled
	}
	return setting
}

func LocalDirectAILogEnabled() bool {
	settings, err := repository.GetSettings()
	if err != nil {
		log.Printf("load local direct ai log setting failed err=%v", err)
		return false
	}
	setting := normalizeAILogSetting(settings.Private.AILog)
	return setting.LocalDirectReportEnabled != nil && *setting.LocalDirectReportEnabled
}

func appendAICallLog(item model.AICallLog) error {
	dir := strings.TrimSpace(config.Cfg.AILogDir)
	if dir == "" {
		dir = filepath.Join("data", "logs", "ai-calls")
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	filePath := filepath.Join(dir, fmt.Sprintf("ai-calls-%s.log", time.Now().Format("2006-01-02")))
	file, err := os.OpenFile(filePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return err
	}
	defer file.Close()
	encoded, err := json.Marshal(item)
	if err != nil {
		return err
	}
	log.New(file, "", 0).Println(string(encoded))
	return nil
}

// readAICallLogs 读取查询日期区间内的日志；filtered 为真时再套用逐条筛选条件。
func readAICallLogs(filter aiLogFilter, filtered bool) ([]model.AICallLog, error) {
	files, err := aiLogFiles()
	if err != nil {
		return nil, err
	}
	items := []model.AICallLog{}
	for _, file := range files {
		if !filter.byRange(file) {
			continue
		}
		fileItems, err := readAICallLogFile(file)
		if err != nil {
			log.Printf("read ai call log file failed file=%s err=%v", file, err)
			continue
		}
		for _, item := range fileItems {
			if filtered && !filter.match(item) {
				continue
			}
			items = append(items, item)
		}
	}
	return items, nil
}

func readAICallLogFile(filePath string) ([]model.AICallLog, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), aiLogScannerMax)
	items := []model.AICallLog{}
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var item model.AICallLog
		if err := json.Unmarshal([]byte(line), &item); err != nil {
			continue
		}
		item.ResponseBody = normalizeAICallResponseLog(item.ResponseBody, item.Error)
		item.Error = normalizeAICallErrorLog(item.Error, item.ResponseBody, nil)
		items = append(items, item)
	}
	return items, scanner.Err()
}

func aiLogFiles() ([]string, error) {
	dir := strings.TrimSpace(config.Cfg.AILogDir)
	if dir == "" {
		dir = filepath.Join("data", "logs", "ai-calls")
	}
	files, err := filepath.Glob(filepath.Join(dir, "ai-calls-*.log"))
	if err != nil {
		return nil, err
	}
	sort.Sort(sort.Reverse(sort.StringSlice(files)))
	return files, nil
}

func aiLogFileDate(filePath string) (time.Time, bool) {
	name := filepath.Base(filePath)
	value := strings.TrimSuffix(strings.TrimPrefix(name, "ai-calls-"), ".log")
	parsed, err := time.ParseInLocation("2006-01-02", value, time.Local)
	return parsed, err == nil
}

func startOfDay(value time.Time) time.Time {
	year, month, day := value.Date()
	return time.Date(year, month, day, 0, 0, 0, 0, value.Location())
}

func aiLogMatchesKeyword(item model.AICallLog, keyword string) bool {
	fields := []string{item.UserID, item.UserDisplayName, item.Endpoint, item.Method, item.Model, item.ChannelID, item.ChannelName, item.RequestBody, item.ResponseBody, item.Error, strconv.Itoa(item.Status)}
	for _, field := range fields {
		if strings.Contains(strings.ToLower(field), keyword) {
			return true
		}
	}
	return false
}

func normalizeAICallResponseLog(responseBody string, errorMessage string) string {
	responseBody = strings.TrimSpace(responseBody)
	if responseBody == "" {
		return ""
	}
	formatted := formatAICallLogPayload(responseBody)
	reason := extractAICallFailureReason(errorMessage, nil)
	if reason == "" {
		reason = extractAICallFailureReason(responseBody, nil)
	}
	if reason == "" {
		return formatted
	}
	if strings.HasPrefix(formatted, "失败原因:") {
		return formatted
	}
	return "失败原因: " + reason + "\n\n原始返回:\n" + formatted
}

func normalizeAICallErrorLog(errorMessage string, responseBody string, failed *bool) string {
	if reason := extractAICallFailureReason(errorMessage, nil); reason != "" {
		return reason
	}
	if reason := extractAICallFailureReason(responseBody, failed); reason != "" {
		return reason
	}
	return cleanPlainLogText(errorMessage)
}

func formatAICallLogPayload(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	var payload any
	if err := json.Unmarshal([]byte(raw), &payload); err == nil {
		redactLargeLogStrings(&payload)
		if encoded, err := json.MarshalIndent(payload, "", "  "); err == nil {
			return string(encoded)
		}
	}
	if strings.Contains(raw, "\ndata:") || strings.HasPrefix(raw, "data:") || strings.Contains(raw, "\nevent:") || strings.HasPrefix(raw, "event:") {
		return formatEventStreamLog(raw)
	}
	return redactLargePlainLogText(raw)
}

func formatEventStreamLog(raw string) string {
	lines := strings.Split(raw, "\n")
	formatted := make([]string, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if !strings.HasPrefix(trimmed, "data:") {
			formatted = append(formatted, redactLargePlainLogText(line))
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(trimmed, "data:"))
		if data == "" || data == "[DONE]" {
			formatted = append(formatted, line)
			continue
		}
		var payload any
		if err := json.Unmarshal([]byte(data), &payload); err != nil {
			formatted = append(formatted, redactLargePlainLogText(line))
			continue
		}
		redactLargeLogStrings(&payload)
		encoded, err := json.Marshal(payload)
		if err != nil {
			formatted = append(formatted, redactLargePlainLogText(line))
			continue
		}
		formatted = append(formatted, "data: "+string(encoded))
	}
	return strings.TrimSpace(strings.Join(formatted, "\n"))
}

func extractAICallFailureReason(raw string, failed *bool) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	var payload any
	if err := json.Unmarshal([]byte(raw), &payload); err == nil {
		reasons := []string{}
		collectAICallFailureReasons(payload, &reasons, failed)
		return strings.Join(dedupeStrings(reasons), "；")
	}
	cleaned := cleanPlainLogText(raw)
	if cleaned == "" || looksLikeSuccessfulLogText(cleaned) {
		return ""
	}
	return cleaned
}

func collectAICallFailureReasons(value any, reasons *[]string, failed *bool) {
	switch typed := value.(type) {
	case map[string]any:
		if message := stringField(typed, "message"); message != "" {
			*reasons = append(*reasons, message)
		}
		if message := stringField(typed, "msg"); message != "" {
			*reasons = append(*reasons, message)
		}
		if detail := stringField(typed, "detail"); detail != "" {
			*reasons = append(*reasons, detail)
		}
		if reason := stringField(typed, "reason"); reason != "" {
			*reasons = append(*reasons, reason)
		}
		if errValue, ok := typed["error"]; ok && errValue != nil {
			before := len(*reasons)
			if message, ok := errValue.(string); ok && strings.TrimSpace(message) != "" {
				*reasons = append(*reasons, strings.TrimSpace(message))
			} else {
				collectAICallFailureReasons(errValue, reasons, failed)
			}
			if failed != nil && len(*reasons) > before {
				*failed = true
			}
		}
		status := strings.ToLower(stringField(typed, "status"))
		typeName := stringField(typed, "type")
		if status == "failed" || status == "incomplete" || status == "cancelled" || status == "canceled" {
			if failed != nil {
				*failed = true
			}
			if typeName == "image_generation_call" {
				*reasons = append(*reasons, "Responses 图像生成调用失败：image_generation_call 状态为 "+status+"，接口未返回具体错误原因")
			} else if typeName != "" {
				*reasons = append(*reasons, typeName+" 状态为 "+status)
			} else {
				*reasons = append(*reasons, "状态为 "+status)
			}
		}
		for key, item := range typed {
			if key == "instructions" || key == "prompt" || key == "requestBody" || key == "responseBody" {
				continue
			}
			collectAICallFailureReasons(item, reasons, failed)
		}
	case []any:
		for _, item := range typed {
			collectAICallFailureReasons(item, reasons, failed)
		}
	}
}

func stringField(values map[string]any, key string) string {
	value, ok := values[key]
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case float64:
		if typed == float64(int64(typed)) {
			return strconv.FormatInt(int64(typed), 10)
		}
		return strconv.FormatFloat(typed, 'f', -1, 64)
	default:
		return ""
	}
}

func dedupeStrings(values []string) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, value := range values {
		value = cleanPlainLogText(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func cleanPlainLogText(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	value = longDataURLPattern.ReplaceAllString(value, "[redacted image data]")
	value = longBase64TextPattern.ReplaceAllString(value, `"[redacted large base64/string]"`)
	value = html.UnescapeString(htmlTagPattern.ReplaceAllString(value, " "))
	value = whitespacePattern.ReplaceAllString(value, " ")
	value = strings.TrimSpace(value)
	if len(value) > aiLogErrorTextLimit {
		return value[:aiLogErrorTextLimit] + "\n... [truncated]"
	}
	return value
}

func redactLargePlainLogText(value string) string {
	value = longDataURLPattern.ReplaceAllString(value, "[redacted image data]")
	value = longBase64TextPattern.ReplaceAllString(value, `"[redacted large base64/string]"`)
	return strings.TrimSpace(value)
}

func redactLargeLogStrings(value *any) {
	switch typed := (*value).(type) {
	case map[string]any:
		for key, item := range typed {
			if text, ok := item.(string); ok && isLargeLogString(text) {
				typed[key] = fmt.Sprintf("[redacted large string len=%d]", len(text))
				continue
			}
			redactLargeLogStrings(&item)
			typed[key] = item
		}
	case []any:
		for index, item := range typed {
			redactLargeLogStrings(&item)
			typed[index] = item
		}
	}
}

func isLargeLogString(value string) bool {
	if strings.HasPrefix(value, "data:image/") {
		return true
	}
	return len(value) > 4096 && looksLikeLogBase64(value)
}

func looksLikeLogBase64(value string) bool {
	for _, char := range value[:min(len(value), 256)] {
		if !(char >= 'A' && char <= 'Z' || char >= 'a' && char <= 'z' || char >= '0' && char <= '9' || char == '+' || char == '/' || char == '=') {
			return false
		}
	}
	return true
}

func looksLikeSuccessfulLogText(value string) bool {
	lower := strings.ToLower(value)
	return !strings.Contains(lower, "error") &&
		!strings.Contains(lower, "failed") &&
		!strings.Contains(lower, "fail") &&
		!strings.Contains(lower, "timeout") &&
		!strings.Contains(lower, "stream_read_error") &&
		!strings.Contains(lower, "502") &&
		!strings.Contains(lower, "500") &&
		!strings.Contains(lower, "429") &&
		!strings.Contains(lower, "401") &&
		!strings.Contains(lower, "403")
}

func truncateLogText(value string, limit int) string {
	value = strings.TrimSpace(value)
	if len(value) <= limit {
		return value
	}
	return value[:limit] + "\n... [truncated]"
}
// aiLogFilter 汇总一次查询的筛选条件，列表、统计和导出共用。
type aiLogFilter struct {
	keyword string
	model   string
	channel string
	result  string
	start   string
	end     string
}

func aiLogFilterOf(q model.Query) aiLogFilter {
	return aiLogFilter{
		keyword: strings.ToLower(strings.TrimSpace(q.Keyword)),
		model:   strings.TrimSpace(q.Model),
		channel: strings.TrimSpace(q.Channel),
		result:  strings.ToLower(strings.TrimSpace(q.Result)),
		start:   aiLogQueryDate(q.StartDate),
		end:     aiLogQueryDate(q.EndDate),
	}
}

// aiLogQueryDate 只接受 yyyy-MM-dd，非法值视为不筛选。
func aiLogQueryDate(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if len(value) > 10 {
		value = value[:10]
	}
	if _, err := time.ParseInLocation(time.DateOnly, value, time.Local); err != nil {
		return ""
	}
	return value
}

// byRange 日志按天分文件，文件名日期可直接用于日期区间裁剪。
func (f aiLogFilter) byRange(filePath string) bool {
	if f.start == "" && f.end == "" {
		return true
	}
	date, ok := aiLogFileDate(filePath)
	if !ok {
		return false
	}
	key := date.Format(time.DateOnly)
	return (f.start == "" || key >= f.start) && (f.end == "" || key <= f.end)
}

func (f aiLogFilter) match(item model.AICallLog) bool {
	if f.model != "" && item.Model != f.model {
		return false
	}
	if f.channel != "" && item.ChannelID != f.channel && item.ChannelName != f.channel {
		return false
	}
	if f.result == "success" && !aiLogSucceeded(item) {
		return false
	}
	if f.result == "failed" && aiLogSucceeded(item) {
		return false
	}
	if f.keyword != "" && !aiLogMatchesKeyword(item, f.keyword) {
		return false
	}
	return true
}

// aiLogSucceeded 与后台列表的成功/失败标签保持同一判定口径。
func aiLogSucceeded(item model.AICallLog) bool {
	return !item.Failed && item.Status >= 200 && item.Status < 400
}

func filterAICallLogs(items []model.AICallLog, filter aiLogFilter) []model.AICallLog {
	result := make([]model.AICallLog, 0, len(items))
	for _, item := range items {
		if filter.match(item) {
			result = append(result, item)
		}
	}
	return result
}

type aiLogAccumulator struct {
	calls         int64
	failed        int64
	credits       float64
	durationTotal int64
	durationCount int64
}

func (a *aiLogAccumulator) add(item model.AICallLog) {
	a.calls++
	if !aiLogSucceeded(item) {
		a.failed++
	}
	a.credits += item.Credits
	if item.DurationMs > 0 {
		a.durationTotal += item.DurationMs
		a.durationCount++
	}
}

func (a aiLogAccumulator) stat(key string) model.AICallLogGroupStat {
	return model.AICallLogGroupStat{
		Key:           key,
		Calls:         a.calls,
		Failed:        a.failed,
		FailureRate:   aiLogRatio(a.failed, a.calls),
		AvgDurationMs: aiLogAverage(a.durationTotal, a.durationCount),
		Credits:       aiLogRound(a.credits, 4),
	}
}

func aiLogAccumulate(target map[string]*aiLogAccumulator, key string, item model.AICallLog) {
	key = strings.TrimSpace(key)
	acc, ok := target[key]
	if !ok {
		acc = &aiLogAccumulator{}
		target[key] = acc
	}
	acc.add(item)
}

func aiLogGroupStats(target map[string]*aiLogAccumulator, unknown string) []model.AICallLogGroupStat {
	result := make([]model.AICallLogGroupStat, 0, len(target))
	for key, acc := range target {
		if key == "" {
			key = unknown
		}
		result = append(result, acc.stat(key))
	}
	sort.SliceStable(result, func(i, j int) bool {
		if result[i].Calls != result[j].Calls {
			return result[i].Calls > result[j].Calls
		}
		return result[i].Key < result[j].Key
	})
	if len(result) > aiLogGroupLimit {
		result = result[:aiLogGroupLimit]
	}
	return result
}

func aiLogDistinct(items []model.AICallLog, key func(model.AICallLog) string) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, item := range items {
		value := strings.TrimSpace(key(item))
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	sort.Strings(result)
	if len(result) > aiLogOptionLimit {
		result = result[:aiLogOptionLimit]
	}
	return result
}

func aiLogItemDate(createdAt string) string {
	createdAt = strings.TrimSpace(createdAt)
	if len(createdAt) >= 10 {
		return createdAt[:10]
	}
	return createdAt
}

func aiLogRound(value float64, digits int) float64 {
	if value == 0 {
		return 0
	}
	factor := math.Pow(10, float64(digits))
	return math.Round(value*factor) / factor
}

func aiLogRatio(part, total int64) float64 {
	if total <= 0 {
		return 0
	}
	return aiLogRound(float64(part)/float64(total), 4)
}

func aiLogAverage(total, count int64) float64 {
	if count <= 0 {
		return 0
	}
	return aiLogRound(float64(total)/float64(count), 2)
}

// aiLogPercentile 取最近秩分位数，样本为空时返回 0。
func aiLogPercentile(values []int64, percent int) int64 {
	if len(values) == 0 {
		return 0
	}
	sorted := append([]int64(nil), values...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	index := (len(sorted)*percent+99)/100 - 1
	if index < 0 {
		index = 0
	}
	if index >= len(sorted) {
		index = len(sorted) - 1
	}
	return sorted[index]
}

func aiLogFirstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

// aiLogCSVCell 把错误信息压成单行，并避免表格软件把内容当公式执行。
func aiLogCSVCell(value string) string {
	value = cleanPlainLogText(value)
	if value == "" {
		return ""
	}
	switch value[0] {
	case '=', '+', '-', '@', '\t', '\r':
		return "'" + value
	}
	return value
}

// AICallLogStats 汇总调用日志用量；模型与渠道候选项只按日期区间裁剪，便于前端回填筛选下拉。
func AICallLogStats(q model.Query) (model.AICallLogStats, error) {
	filter := aiLogFilterOf(q)
	items, err := readAICallLogs(filter, false)
	if err != nil {
		return model.AICallLogStats{}, err
	}
	stats := buildAICallLogStats(filterAICallLogs(items, filter))
	stats.Models = aiLogDistinct(items, func(item model.AICallLog) string { return item.Model })
	stats.Channels = aiLogDistinct(items, func(item model.AICallLog) string {
		return aiLogFirstNonEmpty(item.ChannelName, item.ChannelID)
	})
	return stats, nil
}

func buildAICallLogStats(items []model.AICallLog) model.AICallLogStats {
	stats := model.AICallLogStats{
		Daily:     []model.AICallLogDailyStat{},
		ByModel:   []model.AICallLogGroupStat{},
		ByUser:    []model.AICallLogGroupStat{},
		ByChannel: []model.AICallLogGroupStat{},
	}
	total := aiLogAccumulator{}
	daily := map[string]*aiLogAccumulator{}
	byModel := map[string]*aiLogAccumulator{}
	byUser := map[string]*aiLogAccumulator{}
	byChannel := map[string]*aiLogAccumulator{}
	users := map[string]bool{}
	models := map[string]bool{}
	channels := map[string]bool{}
	durations := []int64{}
	for _, item := range items {
		total.add(item)
		if item.DurationMs > 0 {
			durations = append(durations, item.DurationMs)
		}
		userKey := aiLogFirstNonEmpty(item.UserDisplayName, item.UserID)
		channelKey := aiLogFirstNonEmpty(item.ChannelName, item.ChannelID)
		aiLogAccumulate(daily, aiLogItemDate(item.CreatedAt), item)
		aiLogAccumulate(byModel, item.Model, item)
		aiLogAccumulate(byUser, userKey, item)
		aiLogAccumulate(byChannel, channelKey, item)
		users[userKey] = true
		models[item.Model] = true
		channels[channelKey] = true
	}
	stats.Total = total.calls
	stats.Failed = total.failed
	stats.Success = total.calls - total.failed
	stats.FailureRate = aiLogRatio(total.failed, total.calls)
	stats.AvgDurationMs = aiLogAverage(total.durationTotal, total.durationCount)
	stats.P95DurationMs = aiLogPercentile(durations, 95)
	stats.Credits = aiLogRound(total.credits, 4)
	stats.UserCount = int64(len(users))
	stats.ModelCount = int64(len(models))
	stats.ChannelCount = int64(len(channels))
	dates := make([]string, 0, len(daily))
	for date := range daily {
		dates = append(dates, date)
	}
	sort.Strings(dates)
	for _, date := range dates {
		acc := daily[date]
		stats.Daily = append(stats.Daily, model.AICallLogDailyStat{Date: date, Calls: acc.calls, Failed: acc.failed, Credits: aiLogRound(acc.credits, 4)})
	}
	stats.ByModel = aiLogGroupStats(byModel, "未知模型")
	stats.ByUser = aiLogGroupStats(byUser, "未知用户")
	stats.ByChannel = aiLogGroupStats(byChannel, "未知渠道")
	return stats
}

// ExportAICallLogs 按筛选条件导出 CSV，带 BOM 便于 Excel 直接打开。
func ExportAICallLogs(q model.Query) (model.AICallLogExport, error) {
	items, err := readAICallLogs(aiLogFilterOf(q), true)
	if err != nil {
		return model.AICallLogExport{}, err
	}
	sort.SliceStable(items, func(i, j int) bool {
		return items[i].CreatedAt > items[j].CreatedAt
	})
	total := len(items)
	truncated := total > aiLogExportRowLimit
	if truncated {
		items = items[:aiLogExportRowLimit]
	}
	var builder strings.Builder
	builder.WriteString("\ufeff")
	writer := csv.NewWriter(&builder)
	_ = writer.Write([]string{"时间", "用户", "接口", "方法", "模型", "渠道", "状态", "结果", "耗时(ms)", "扣点", "错误"})
	for _, item := range items {
		result := "成功"
		if !aiLogSucceeded(item) {
			result = "失败"
		}
		_ = writer.Write([]string{
			item.CreatedAt,
			aiLogFirstNonEmpty(item.UserDisplayName, item.UserID),
			item.Endpoint,
			item.Method,
			item.Model,
			aiLogFirstNonEmpty(item.ChannelName, item.ChannelID),
			strconv.Itoa(item.Status),
			result,
			strconv.FormatInt(item.DurationMs, 10),
			strconv.FormatFloat(item.Credits, 'f', -1, 64),
			aiLogCSVCell(item.Error),
		})
	}
	writer.Flush()
	return model.AICallLogExport{
		FileName:  "ai-calls-" + time.Now().Format("20060102-150405") + ".csv",
		Content:   builder.String(),
		Total:     total,
		Truncated: truncated,
	}, nil
}
