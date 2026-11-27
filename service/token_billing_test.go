package service

import "testing"

func TestTokenUsageCredits(t *testing.T) {
	prices := TokenPrices{Input: 2, Output: 3, Cache: 0.9, Rate: 1}
	// 1000 输入（其中 400 命中缓存）+ 500 输出 = (600*2 + 400*0.9 + 500*3)/1e6 = 0.003060 元
	got := TokenUsageCredits(prices, 1000, 500, 400)
	if got != 0.0031 {
		t.Fatalf("credits=%v want 0.0031", got)
	}
	// 无缓存价时按输入价计
	got = TokenUsageCredits(TokenPrices{Input: 2, Output: 3, Rate: 1}, 1000, 500, 0)
	if got != 0.0035 {
		t.Fatalf("credits=%v want 0.0035", got)
	}
	// 缓存数超过输入数时按输入数封顶
	got = TokenUsageCredits(TokenPrices{Input: 2, Output: 3, Cache: 0.9, Rate: 1}, 1000, 0, 5000)
	if got != 0.0009 {
		t.Fatalf("credits=%v want 0.0009", got)
	}
	if credits := TokenUsageCredits(TokenPrices{}, 100, 100, 0); credits != 0 {
		t.Fatalf("zero prices should be free, got %v", credits)
	}
}
