package service

import (
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"net"
	"net/smtp"
	"strings"

	"github.com/tigerowo/infinite-canvas/config"
)

// SMTPConfigured 是否已配置邮件通道。
func SMTPConfigured() bool {
	return strings.TrimSpace(config.Cfg.SMTPHost) != "" &&
		strings.TrimSpace(config.Cfg.SMTPUser) != "" &&
		strings.TrimSpace(config.Cfg.SMTPPass) != ""
}

func smtpFromAddress() string {
	if from := strings.TrimSpace(config.Cfg.SMTPFrom); from != "" {
		return from
	}
	return config.Cfg.SMTPUser
}

func encodeMailHeader(value string) string {
	for _, r := range value {
		if r > 127 {
			return "=?UTF-8?B?" + base64.StdEncoding.EncodeToString([]byte(value)) + "?="
		}
	}
	return value
}

// envelopeAddress 取 SMTP 信封地址（MAIL FROM / RCPT TO 只接受裸地址，不能带显示名）。
func envelopeAddress(value string) string {
	v := strings.TrimSpace(value)
	if i := strings.Index(v, "<"); i >= 0 {
		if j := strings.Index(v[i:], ">"); j >= 0 {
			return strings.TrimSpace(v[i+1 : i+j])
		}
	}
	return v
}

// formatFromHeader 把「显示名 <地址>」转成合规的 From 头（显示名按 RFC 2047 编码）。
func formatFromHeader(from string) string {
	if i := strings.Index(from, "<"); i >= 0 {
		name := strings.TrimSpace(strings.Trim(from[:i], "\""))
		addr := strings.TrimSpace(from[i:])
		if name != "" {
			return encodeMailHeader(name) + " " + addr
		}
	}
	return from
}

func wrapMailBase64(body string) string {
	var lines []string
	for i := 0; i < len(body); i += 76 {
		end := i + 76
		if end > len(body) {
			end = len(body)
		}
		lines = append(lines, body[i:end])
	}
	return strings.Join(lines, "\r\n")
}

// SendMail 发送纯文本邮件。SMTPSecure=true 走 465 隐式 TLS，否则走 STARTTLS（587）。
func SendMail(to, subject, text string) error {
	host := strings.TrimSpace(config.Cfg.SMTPHost)
	port := config.Cfg.SMTPPort
	if port <= 0 {
		port = 465
	}
	from := smtpFromAddress()
	message := strings.Join([]string{
		"From: " + formatFromHeader(from),
		"To: " + to,
		"Subject: " + encodeMailHeader(subject),
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"Content-Transfer-Encoding: base64",
		"",
		wrapMailBase64(base64.StdEncoding.EncodeToString([]byte(text))),
	}, "\r\n")
	auth := smtp.PlainAuth("", config.Cfg.SMTPUser, config.Cfg.SMTPPass, host)
	var conn net.Conn
	var err error
	if config.Cfg.SMTPSecure {
		conn, err = tls.Dial("tcp", fmt.Sprintf("%s:%d", host, port), &tls.Config{ServerName: host})
	} else {
		conn, err = net.Dial("tcp", fmt.Sprintf("%s:%d", host, port))
	}
	if err != nil {
		return err
	}
	client, err := smtp.NewClient(conn, host)
	if err != nil {
		return err
	}
	defer client.Close()
	if !config.Cfg.SMTPSecure {
		if ok, _ := client.Extension("STARTTLS"); ok {
			if err := client.StartTLS(&tls.Config{ServerName: host}); err != nil {
				return err
			}
		}
	}
	if err := client.Auth(auth); err != nil {
		return err
	}
	if err := client.Mail(envelopeAddress(from)); err != nil {
		return err
	}
	if err := client.Rcpt(envelopeAddress(to)); err != nil {
		return err
	}
	writer, err := client.Data()
	if err != nil {
		return err
	}
	if _, err := writer.Write([]byte(message)); err != nil {
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}
	return client.Quit()
}
