package service

import (
	"strings"
	"testing"

	"github.com/tigerowo/infinite-canvas/model"
)

func TestNormalizeLegalSettingFillsTitlesAndTrims(t *testing.T) {
	setting := normalizeLegalSetting(model.LegalSetting{
		Terms: model.LegalDocument{Content: "  正文内容  ", Enabled: true},
	})
	if setting.Terms.Title != "用户协议" {
		t.Fatalf("terms title = %q, want default title", setting.Terms.Title)
	}
	if setting.Terms.Content != "正文内容" {
		t.Fatalf("terms content = %q, want trimmed content", setting.Terms.Content)
	}
	if setting.Privacy.Title != "隐私政策" || setting.About.Title != "关于我们" {
		t.Fatalf("default titles = %q/%q", setting.Privacy.Title, setting.About.Title)
	}
}

func TestNormalizeLegalSettingDisablesEmptyContent(t *testing.T) {
	setting := normalizeLegalSetting(model.LegalSetting{
		Privacy: model.LegalDocument{Title: "自定义隐私", Content: "   ", Enabled: true},
	})
	if setting.Privacy.Enabled {
		t.Fatal("document with blank content should be disabled")
	}
	if setting.Privacy.Title != "自定义隐私" {
		t.Fatalf("custom title overwritten: %q", setting.Privacy.Title)
	}
}

func TestNormalizeLegalSettingTruncatesLongContent(t *testing.T) {
	setting := normalizeLegalSetting(model.LegalSetting{
		About: model.LegalDocument{Content: strings.Repeat("字", legalContentLimit+50), Enabled: true},
	})
	if len([]rune(setting.About.Content)) != legalContentLimit {
		t.Fatalf("content runes = %d, want %d", len([]rune(setting.About.Content)), legalContentLimit)
	}
}

func TestPublishedLegalSettingHidesDisabledOrEmpty(t *testing.T) {
	published := publishedLegalSetting(model.LegalSetting{
		Terms:   model.LegalDocument{Title: "用户协议", Content: "正文", Enabled: true},
		Privacy: model.LegalDocument{Title: "隐私政策", Content: "正文", Enabled: false},
		About:   model.LegalDocument{Title: "关于我们", Content: "", Enabled: true},
	})
	if published.Terms.Content != "正文" {
		t.Fatalf("enabled document should be published: %+v", published.Terms)
	}
	if published.Privacy.Content != "" || published.Privacy.Enabled {
		t.Fatalf("disabled document leaked: %+v", published.Privacy)
	}
	if published.About.Content != "" || published.About.Enabled {
		t.Fatalf("empty document leaked: %+v", published.About)
	}
}