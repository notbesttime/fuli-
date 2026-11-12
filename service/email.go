package service

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math/big"
	"regexp"
	"strings"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

const (
	emailCodeTTL         = 5 * time.Minute
	emailCodeCooldown    = time.Minute
	emailCodeWindow      = 24 * time.Hour
	emailCodeDailyLimit  = 15
	emailCodeMaxAttempts = 5
)

var (
	emailPattern = regexp.MustCompile(`^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$`)
	codePattern  = regexp.MustCompile(`^\d{6}$`)
)

func normalizeEmail(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func validEmail(email string) bool {
	return email != "" && len(email) <= 254 && emailPattern.MatchString(email)
}

func hashEmailCode(code string) string {
	digest := sha256.Sum256([]byte(code))
	return hex.EncodeToString(digest[:])
}

func randomEmailCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

// IssueEmailCode 生成并发送邮箱验证码；purpose 为 register 或 recover。
func IssueEmailCode(email, purpose string) error {
	email = normalizeEmail(email)
	if !validEmail(email) {
		return safeMessageError{message: "请输入有效的邮箱地址"}
	}
	if purpose != "register" && purpose != "recover" {
		return safeMessageError{message: "验证码用途无效"}
	}
	if !SMTPConfigured() {
		return safeMessageError{message: "邮件通道未配置，请联系管理员"}
	}
	if purpose == "register" {
		if _, ok, err := repository.GetUserByEmail(email); err != nil {
			return err
		} else if ok {
			return safeMessageError{message: "该邮箱已绑定账号"}
		}
	} else {
		if _, ok, err := repository.GetUserByEmail(email); err != nil {
			return err
		} else if !ok {
			return safeMessageError{message: "该邮箱未绑定账号"}
		}
	}
	if last, ok, err := repository.LatestEmailCode(email, purpose); err != nil {
		return err
	} else if ok && time.Since(time.Unix(last.CreatedAt, 0)) < emailCodeCooldown {
		return safeMessageError{message: "验证码发送过于频繁，请稍后再试"}
	}
	if count, err := repository.CountEmailCodesSince(email, time.Now().Add(-emailCodeWindow).Unix()); err != nil {
		return err
	} else if count >= emailCodeDailyLimit {
		return safeMessageError{message: "该邮箱今日验证码次数已达上限"}
	}
	code, err := randomEmailCode()
	if err != nil {
		return err
	}
	record := model.EmailCode{
		ID:        newID("email-code"),
		Email:     email,
		Purpose:   purpose,
		CodeHash:  hashEmailCode(code),
		ExpiresAt: time.Now().Add(emailCodeTTL).Unix(),
		CreatedAt: time.Now().Unix(),
	}
	if err := repository.SaveEmailCode(record); err != nil {
		return err
	}
	subject := "福鲤绘注册验证码"
	if purpose == "recover" {
		subject = "福鲤绘找回验证码"
	}
	if err := SendMail(email, subject, "您好，您的验证码是 "+code+"，有效时间5分钟。"); err != nil {
		return safeMessageError{message: "验证码邮件发送失败，请稍后重试"}
	}
	return nil
}

// VerifyEmailCode 校验验证码（不消费，注册/重置成功后才消费）。
func VerifyEmailCode(email, purpose, code string) error {
	email = normalizeEmail(email)
	if !codePattern.MatchString(code) {
		return safeMessageError{message: "请输入 6 位数字验证码"}
	}
	record, ok, err := repository.LatestEmailCode(email, purpose)
	if err != nil {
		return err
	}
	if !ok || time.Now().Unix() > record.ExpiresAt {
		return safeMessageError{message: "验证码错误或已过期"}
	}
	if record.Attempts >= emailCodeMaxAttempts {
		return safeMessageError{message: "验证码尝试次数过多，请重新获取"}
	}
	if record.CodeHash != hashEmailCode(code) {
		record.Attempts++
		_ = repository.UpdateEmailCode(record)
		return safeMessageError{message: "验证码错误或已过期"}
	}
	return nil
}

func consumeEmailCode(email, purpose string) error {
	record, ok, err := repository.LatestEmailCode(email, purpose)
	if err != nil || !ok {
		return err
	}
	record.ConsumedAt = time.Now().Unix()
	return repository.UpdateEmailCode(record)
}
