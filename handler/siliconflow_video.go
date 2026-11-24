package handler

import (
	"encoding/json"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/service"
)

func isSiliconFlowChannel(channel model.ModelChannel) bool {
	return strings.EqualFold(strings.TrimSpace(channel.Protocol), service.ModelChannelProtocolSiliconFlow)
}

// transformSiliconFlowVideoSubmit 提交响应 {"requestId":"xxx"} → 标准任务格式
func transformSiliconFlowVideoSubmit(payload []byte) ([]byte, bool) {
	var root struct {
		RequestID string `json:"requestId"`
	}
	if json.Unmarshal(payload, &root) != nil || root.RequestID == "" {
		return nil, false
	}
	transformed, err := json.Marshal(map[string]any{
		"task_id":   root.RequestID,
		"status":    "processing",
		"progress":  0,
	})
	return transformed, err == nil
}

// transformSiliconFlowVideoStatus 轮询响应 → 标准任务格式
// {"status":"InProgress","position":0,"results":null}
// {"status":"Succeed","results":{"videos":[{"url":"..."}]}}
func transformSiliconFlowVideoStatus(payload []byte) ([]byte, bool) {
	var root struct {
		Status   string `json:"status"`
		Position int    `json:"position"`
		Reason   string `json:"reason"`
		Results  *struct {
			Videos []struct {
				URL string `json:"url"`
			} `json:"videos"`
		} `json:"results"`
	}
	if json.Unmarshal(payload, &root) != nil {
		return nil, false
	}
	result := map[string]any{
		"status":   "processing",
		"progress": root.Position,
	}
	if root.Status == "Succeed" && root.Results != nil && len(root.Results.Videos) > 0 {
		result["status"] = "completed"
		result["progress"] = 100
		result["video_url"] = root.Results.Videos[0].URL
	} else if root.Status == "Failed" || root.Status == "Error" {
		result["status"] = "failed"
		result["error"] = map[string]any{"message": root.Reason}
	}
	transformed, err := json.Marshal(result)
	return transformed, err == nil
}
