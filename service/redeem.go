package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"math"
	"strings"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

const maxRedeemAmount = 1_000_000
const maxRedeemCount = 500

type CreateRedeemCodesRequest struct {
	Amount    float64 `json:"amount"`
	Count     int     `json:"count"`
	ExpiresAt string  `json:"expiresAt"`
	Remark    string  `json:"remark"`
}

type RedeemResult struct {
	User    model.AuthUser `json:"user"`
	Credits float64        `json:"credits"`
	Amount  float64        `json:"amount"`
}

func redeemNow() string {
	t, _ := time.Parse(time.RFC3339, now())
	return t.UTC().Format(time.RFC3339)
}

func validRechargeAmount(amount float64) bool {
	return !math.IsNaN(amount) && !math.IsInf(amount, 0) && amount >= 0.01 && amount <= maxRedeemAmount && math.Abs(amount*100-math.Round(amount*100)) < 1e-6
}

func requireRedeemUser(ctx context.Context, admin bool) (model.AuthUser, error) {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" || (user.Role != model.UserRoleUser && user.Role != model.UserRoleAdmin) || (admin && user.Role != model.UserRoleAdmin) {
		return model.AuthUser{}, safeMessageError{message: "未登录或权限不足"}
	}
	return user, nil
}

func CreateRedeemCodes(ctx context.Context, req CreateRedeemCodesRequest) (model.RedeemCodeList, error) {
	if _, err := requireRedeemUser(ctx, true); err != nil {
		return model.RedeemCodeList{}, err
	}
	if !validRechargeAmount(req.Amount) {
		return model.RedeemCodeList{}, safeMessageError{message: "金额须为 0.01 至 1000000 元，最多两位小数"}
	}
	if req.Count < 1 || req.Count > maxRedeemCount {
		return model.RedeemCodeList{}, safeMessageError{message: "每批数量须为 1 至 500"}
	}
	req.Remark = strings.TrimSpace(req.Remark)
	if len([]rune(req.Remark)) > 1000 {
		return model.RedeemCodeList{}, safeMessageError{message: "备注不能超过 1000 字"}
	}
	timestamp := redeemNow()
	if strings.TrimSpace(req.ExpiresAt) != "" {
		expires, err := time.Parse(time.RFC3339, strings.TrimSpace(req.ExpiresAt))
		if err != nil {
			return model.RedeemCodeList{}, safeMessageError{message: "过期时间须为 RFC3339 格式"}
		}
		req.ExpiresAt = expires.UTC().Format(time.RFC3339)
		if req.ExpiresAt <= timestamp {
			return model.RedeemCodeList{}, safeMessageError{message: "过期时间必须晚于当前时间"}
		}
	} else {
		req.ExpiresAt = ""
	}
	settings, err := PublicSettings()
	if err != nil {
		return model.RedeemCodeList{}, err
	}
	credits := normalizeCredits(req.Amount / settings.ModelChannel.Pricing.CreditRate)
	if math.IsNaN(credits) || math.IsInf(credits, 0) || credits < 0.01 || credits > 1e12 {
		return model.RedeemCodeList{}, safeMessageError{message: "当前汇率无法生成有效算力点，请调整金额或汇率"}
	}
	items := make([]model.RedeemCode, req.Count)
	batch := newID("redeem-batch")
	for i := range items {
		buf := make([]byte, 24)
		if _, err := rand.Read(buf); err != nil {
			return model.RedeemCodeList{}, err
		}
		items[i] = model.RedeemCode{ID: newID("redeem"), Code: "R" + strings.ToUpper(hex.EncodeToString(buf)), Amount: normalizeCredits(req.Amount), Credits: credits, Status: model.RedeemCodeUnused, Batch: batch, ExpiresAt: req.ExpiresAt, Remark: req.Remark, CreatedAt: timestamp}
	}
	if err := repository.CreateRedeemCodes(items); err != nil {
		return model.RedeemCodeList{}, err
	}
	return model.RedeemCodeList{Items: items, Total: len(items)}, nil
}

func ListRedeemCodes(ctx context.Context, q model.Query) (model.RedeemCodeList, error) {
	if _, err := requireRedeemUser(ctx, true); err != nil {
		return model.RedeemCodeList{}, err
	}
	q.Type = strings.TrimSpace(q.Type)
	switch model.RedeemCodeStatus(q.Type) {
	case "", model.RedeemCodeUnused, model.RedeemCodeUsed, model.RedeemCodeVoid, model.RedeemCodeExpired:
	default:
		return model.RedeemCodeList{}, safeMessageError{message: "兑换码状态无效"}
	}
	timestamp := redeemNow()
	items, total, err := repository.ListRedeemCodes(q, timestamp)
	for i := range items {
		if items[i].Status == model.RedeemCodeUnused && items[i].ExpiresAt != "" && items[i].ExpiresAt <= timestamp {
			items[i].Status = model.RedeemCodeExpired
		}
	}
	return model.RedeemCodeList{Items: items, Total: int(total)}, err
}

func VoidRedeemCode(ctx context.Context, id string) error {
	if _, err := requireRedeemUser(ctx, true); err != nil {
		return err
	}
	ok, err := repository.VoidRedeemCode(strings.TrimSpace(id), redeemNow())
	if err != nil {
		return err
	}
	if !ok {
		return safeMessageError{message: "仅可作废未使用且未过期的兑换码"}
	}
	return nil
}

func Redeem(ctx context.Context, code string) (RedeemResult, error) {
	user, err := requireRedeemUser(ctx, false)
	if err != nil {
		return RedeemResult{}, err
	}
	code = strings.ToUpper(strings.TrimSpace(code))
	if len(code) != 49 || !strings.HasPrefix(code, "R") {
		return RedeemResult{}, safeMessageError{message: "兑换码无效、已使用或已失效"}
	}
	if _, err := hex.DecodeString(code[1:]); err != nil {
		return RedeemResult{}, safeMessageError{message: "兑换码无效、已使用或已失效"}
	}
	timestamp := redeemNow()
	item, updated, ok, err := repository.RedeemCode(code, user.ID, timestamp, model.CreditLog{ID: newID("credit"), UserID: user.ID, Type: model.CreditLogTypeRedeem, Remark: "兑换码充值", CreatedAt: timestamp})
	if err != nil {
		return RedeemResult{}, err
	}
	if !ok {
		return RedeemResult{}, safeMessageError{message: "兑换码无效、已使用或已失效"}
	}
	return RedeemResult{User: model.PublicUser(updated), Credits: item.Credits, Amount: item.Amount}, nil
}

func ListRedeemRecords(ctx context.Context, q model.Query) (model.RedeemRecordList, error) {
	user, err := requireRedeemUser(ctx, false)
	if err != nil {
		return model.RedeemRecordList{}, err
	}
	items, total, err := repository.ListUserRedeemCodes(user.ID, q)
	records := make([]model.RedeemRecord, 0, len(items))
	for _, item := range items {
		masked := "****"
		if len(item.Code) > 8 {
			masked = item.Code[:4] + "****" + item.Code[len(item.Code)-4:]
		}
		records = append(records, model.RedeemRecord{ID: item.ID, Code: masked, Amount: item.Amount, Credits: item.Credits, UsedAt: item.UsedAt, CreatedAt: item.CreatedAt})
	}
	return model.RedeemRecordList{Items: records, Total: int(total)}, err
}
