package handler

import (
	"context"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
	"github.com/tigerowo/infinite-canvas/service"
)

func TestPublicModelGroupsAndAnnouncements(t *testing.T) {
	// Isolate the repository's singleton from every other integration fixture.
	const marker = "PUBLIC_MODEL_GROUP_CHILD"
	if os.Getenv(marker) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestPublicModelGroupsAndAnnouncements$", "-test.timeout=55s", "-test.v")
		cmd.Env = append(os.Environ(), marker+"=1")
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("isolated group regressions: %v\n%s", err, output)
		}
		t.Log(string(output))
		return
	}
	previous := config.Cfg
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: ":memory:", JWTSecret: "isolated-group-secret", AILogDir: t.TempDir()}
	t.Cleanup(func() { config.Cfg = previous })
	blockProtocolNetwork(t)
	db, err := repository.DB()
	if err != nil {
		t.Fatal(err)
	}
	connection, _ := db.DB()
	connection.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = connection.Close() })
	enabled := true
	settings := model.Settings{Public: model.PublicSetting{ModelChannel: model.PublicModelChannelSetting{
		AllowUserRemoteChannel: &enabled,
		Pricing:                model.PricingSetting{CreditRate: 1, Groups: []model.ModelGroup{{ID: "default", Ratio: 1}, {ID: "cheap", Ratio: 0.1}, {ID: "premium", Ratio: 2}}},
		ModelCosts:             []model.ModelCost{{Model: "group-model", Price: 10, BillingMode: model.BillingModeRequest}},
	}}}
	for _, id := range []string{"cheap-a", "cheap-b", "premium", "default"} {
		group := id
		if strings.HasPrefix(id, "cheap-") {
			group = "cheap"
		}
		channel := model.ModelChannel{ID: id, Name: id, Protocol: "openai", BaseURL: "https://groups.invalid", APIKey: id + "-secret", Models: []string{"group-model"}, Groups: []string{group}, Enabled: true, Weight: 1}
		if id == "default" {
			channel.Groups = nil
		}
		settings.Private.Channels = append(settings.Private.Channels, channel)
	}
	saveSettings := func() {
		t.Helper()
		if _, err := repository.SaveSettings(settings, "fixture"); err != nil {
			t.Fatal(err)
		}
	}
	saveSettings()
	account, err := service.SaveUser(model.User{Username: "group-user", Role: model.UserRoleUser, Status: model.UserStatusActive, Group: "future-account-entitlement", Credits: 1000}, "group-password")
	if err != nil {
		t.Fatal(err)
	}
	session, err := service.Login(account.Username, "group-password")
	if err != nil {
		t.Fatal(err)
	}
	auth := func() model.AuthUser {
		t.Helper()
		user, ok := service.CurrentAuthUser(session.Token)
		if !ok {
			t.Fatal("saved token stopped authenticating")
		}
		return user
	}
	userContext := func() context.Context { return service.WithUser(context.Background(), auth()) }
	switchGroup := func(group string) {
		t.Helper()
		preferences, err := service.SaveUserPreferences(userContext(), model.UserPreferences{PreferredGroup: group})
		if err != nil || preferences.PreferredGroup != group {
			t.Fatalf("select %s: %+v %v", group, preferences, err)
		}
	}
	balance := func() float64 {
		t.Helper()
		user, found, err := repository.GetUserByID(account.ID)
		if err != nil || !found {
			t.Fatalf("balance: %v %v", found, err)
		}
		return user.Credits
	}
	assertCharge := func(before, amount float64, group string, ratio float64) {
		t.Helper()
		if got := before - balance(); math.Abs(got-amount) > 0.000001 {
			t.Fatalf("charged %v want %v", got, amount)
		}
		var log model.CreditLog
		if err := db.Where("user_id = ? AND type = ?", account.ID, model.CreditLogTypeAIConsume).Order("rowid DESC").First(&log).Error; err != nil {
			t.Fatal(err)
		}
		var extra struct {
			Group      string
			GroupRatio float64
		}
		if err := json.Unmarshal([]byte(log.Extra), &extra); err != nil || extra.Group != group || extra.GroupRatio != ratio {
			t.Fatalf("charge snapshot: %s %v", log.Extra, err)
		}
	}
	call := func(handler http.HandlerFunc, pin string, ctx context.Context) *httptest.ResponseRecorder {
		t.Helper()
		request := httptest.NewRequest(http.MethodPost, "/fixture", strings.NewReader(`{"model":"group-model","messages":[],"input":"hello","seconds":1}`))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("X-Model-Channel-ID", pin)
		if ctx == nil {
			ctx = userContext()
		}
		request = request.WithContext(ctx)
		recorder := httptest.NewRecorder()
		handler(recorder, request)
		return recorder
	}
	success := func(request *http.Request) (*http.Response, error) {
		body, contentType := `{"choices":[]}`, "application/json"
		switch request.URL.Path {
		case "/v1/images/generations":
			body = `{"data":[{"url":"https://media.invalid/image"}]}`
		case "/v1/audio/speech":
			body, contentType = "audio-data", "audio/wav"
		case "/v1/videos":
			body = `{"id":"group-video-task","status":"processing"}`
		}
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {contentType}}, Body: io.NopCloser(strings.NewReader(body))}, nil
	}

	t.Run("any configured group and partial preference saves", func(t *testing.T) {
		switchGroup("cheap")
		if user := auth(); user.PreferredGroup != "cheap" || user.Group != account.Group {
			t.Fatalf("auth groups: %+v", user)
		}
		saved, err := service.SaveUserPreferences(userContext(), model.UserPreferences{BillingStrategy: "wallet_only"})
		if err != nil || saved.PreferredGroup != "cheap" {
			t.Fatalf("partial strategy: %+v %v", saved, err)
		}
		switchGroup("premium")
		saved, err = service.UserPreferences(userContext())
		if err != nil || saved.BillingStrategy != "wallet_only" || saved.PreferredGroup != "premium" {
			t.Fatalf("partial group: %+v %v", saved, err)
		}
		if _, err := service.SaveUserPreferences(userContext(), model.UserPreferences{PreferredGroup: "unknown"}); err == nil {
			t.Fatal("accepted unknown group")
		}
	})

	t.Run("lowest price applies to every new image text audio video call", func(t *testing.T) {
		switchGroup("cheap")
		for _, handler := range []http.HandlerFunc{AIImagesGenerations, AIChatCompletions, AIAudioSpeech, AIVideos} {
			protocolMockHTTP(t, func(request *http.Request) (*http.Response, error) {
				if request.Header.Get("Authorization") != "Bearer cheap-a-secret" {
					t.Errorf("wrong group credential: %s", request.Header.Get("Authorization"))
				}
				return success(request)
			})
			before := balance()
			recorder := call(handler, "cheap-a", nil)
			if recorder.Code != 200 || strings.Contains(recorder.Body.String(), `"code":1`) {
				t.Fatalf("call: %d %s", recorder.Code, recorder.Body)
			}
			assertCharge(before, 1, "cheap", 0.1)
		}
		switchGroup("premium")
		protocolMockHTTP(t, func(request *http.Request) (*http.Response, error) {
			if request.Header.Get("Authorization") != "Bearer premium-secret" {
				t.Errorf("next call used old credential")
			}
			return success(request)
		})
		before := balance()
		call(AIChatCompletions, "", nil)
		assertCharge(before, 20, "premium", 2)
	})

	t.Run("sub-cent group prices remain charged to four-decimal wallet and ledger", func(t *testing.T) {
		switchGroup("cheap")
		settings.Public.ModelChannel.ModelCosts[0].Price = 0.01
		saveSettings()
		defer func() {
			settings.Public.ModelChannel.ModelCosts[0].Price = 10
			saveSettings()
		}()
		protocolMockHTTP(t, func(request *http.Request) (*http.Response, error) { return success(request) })
		before := balance()
		recorder := call(AIChatCompletions, "", nil)
		if recorder.Code != 200 {
			t.Fatalf("call: %d %s", recorder.Code, recorder.Body)
		}
		assertCharge(before, 0.001, "cheap", 0.1)
		var entry model.CreditLog
		if err := db.Where("user_id = ? AND type = ?", account.ID, model.CreditLogTypeAIConsume).Order("rowid DESC").First(&entry).Error; err != nil {
			t.Fatal(err)
		}
		if math.Abs(entry.Amount+0.001) > 0.000001 || math.Abs(entry.Balance-balance()) > 0.000001 {
			t.Fatalf("ledger lost fractional credit: amount=%v balance=%v", entry.Amount, entry.Balance)
		}
	})

	t.Run("cross group pin cannot route or charge", func(t *testing.T) {
		switchGroup("cheap")
		before := balance()
		recorder := call(AIChatCompletions, "premium", nil)
		if !strings.Contains(recorder.Body.String(), "当前分组") || balance() != before {
			t.Fatalf("cross-group pin: %s", recorder.Body)
		}
	})

	t.Run("explicit canvas group controls routing and unit price", func(t *testing.T) {
		switchGroup("cheap")
		snapshot, err := service.WithModelGroupSnapshot(userContext(), auth(), "premium")
		if err != nil {
			t.Fatal(err)
		}
		billing := service.RequestBillingSnapshot(snapshot)
		if billing.Group != "premium" || billing.GroupRatio != 2 {
			t.Fatalf("billing snapshot = %+v", billing)
		}
		channel, err := service.SelectModelChannelInContext(snapshot, "group-model", "", true)
		if err != nil || channel.ID != "premium" {
			t.Fatalf("group channel = %q, %v", channel.ID, err)
		}
		usage, err := service.ResolveModelUsageCostInContext(snapshot, "group-model")
		if err != nil || usage.Credits != 20 {
			t.Fatalf("group price = %+v, %v", usage, err)
		}
		frozen := model.ModelBillingSnapshot{Group: "premium", GroupRatio: 2, Model: "group-model", UsageCredits: 7, UsagePrice: 7, BillingMode: model.BillingModeRequest, HasUsageCost: true}
		frozenContext, err := service.WithCanvasTaskBillingSnapshot(snapshot, auth(), frozen)
		if err != nil {
			t.Fatal(err)
		}
		usage, err = service.ResolveModelUsageCostInContext(frozenContext, "group-model")
		if err != nil || usage.Credits != 7 {
			t.Fatalf("persisted task price = %+v, %v", usage, err)
		}
		task, err := service.CreateCanvasImageTask(service.CanvasImageTaskCreateInput{
			UserID:          account.ID,
			Model:           "group-model",
			BillingSnapshot: frozen,
		})
		if err != nil {
			t.Fatal(err)
		}
		persistedTask, found, err := service.GetUserCanvasImageTask(account.ID, task.ID)
		if err != nil || !found || persistedTask.BillingSnapshot != frozen {
			t.Fatalf("persisted canvas billing snapshot = %+v found=%v err=%v", persistedTask.BillingSnapshot, found, err)
		}
		response := service.CanvasImageTaskResponse(persistedTask)
		if response["billingGroup"] != frozen.Group || response["groupRatio"] != frozen.GroupRatio {
			t.Fatalf("task response billing fields = %#v", response)
		}
		if _, exposed := response["billingSnapshot"]; exposed {
			t.Fatal("internal billing snapshot leaked into task response")
		}
	})
	t.Run("group with no published model cannot bypass publication", func(t *testing.T) {
		switchGroup("cheap")
		prior := settings.Private.Channels[1].Models
		settings.Private.Channels[0].Models = []string{"hidden-model"}
		settings.Private.Channels[1].Models = []string{"hidden-model"}
		settings.Public.ModelChannel.AvailableModels = []string{"group-model"}
		saveSettings()
		t.Cleanup(func() {
			settings.Private.Channels[0].Models = prior
			settings.Private.Channels[1].Models = prior
			settings.Public.ModelChannel.AvailableModels = nil
			saveSettings()
		})
		snapshot, err := service.WithModelGroupSnapshot(userContext(), auth())
		if err != nil {
			t.Fatal(err)
		}
		if _, err := service.SelectModelChannelInContext(snapshot, "hidden-model", "cheap-b", true); err == nil {
			t.Fatal("unpublished group model routed")
		}
	})

	t.Run("retry retains original group even after preference and settings switch", func(t *testing.T) {
		switchGroup("cheap")
		requests := []string{}
		protocolMockHTTP(t, func(request *http.Request) (*http.Response, error) {
			key := request.Header.Get("Authorization")
			requests = append(requests, key)
			if len(requests) == 1 {
				if key != "Bearer cheap-a-secret" {
					t.Fatalf("first credential %s", key)
				}
				switchGroup("premium")
				settings.Public.ModelChannel.Pricing.Groups[1].Ratio = 0.9
				settings.Private.Channels[1].Groups = []string{"premium"}
				saveSettings()
				return &http.Response{StatusCode: 401, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"error":{"message":"retry"}}`))}, nil
			}
			if key != "Bearer cheap-b-secret" {
				t.Errorf("retry escaped original group: %s", key)
			}
			return success(request)
		})
		before := balance()
		recorder := call(AIChatCompletions, "cheap-a", nil)
		if len(requests) != 2 || recorder.Header().Get("X-Resolved-Channel-ID") != "cheap-b" {
			t.Fatalf("retry: %v %s", requests, recorder.Body)
		}
		assertCharge(before, 1, "cheap", 0.1)
		settings.Public.ModelChannel.Pricing.Groups[1].Ratio = 0.1
		settings.Private.Channels[1].Groups = []string{"cheap"}
		saveSettings()
	})

	t.Run("canvas child retains parent snapshot", func(t *testing.T) {
		switchGroup("cheap")
		parent, err := service.WithModelGroupSnapshot(userContext(), auth())
		if err != nil {
			t.Fatal(err)
		}
		switchGroup("premium")
		protocolMockHTTP(t, func(request *http.Request) (*http.Response, error) {
			if request.Header.Get("Authorization") != "Bearer cheap-b-secret" {
				t.Errorf("child used switched group")
			}
			return success(request)
		})
		child := service.CopyModelGroupSnapshot(context.Background(), parent)
		before := balance()
		_, status, _, _, err := executeCanvasAIRequest(child, auth(), "/audio/speech", []byte(`{"model":"group-model","input":"hi"}`), "application/json", "cheap-b", "")
		if err != nil || status != 200 {
			t.Fatalf("child: %d %v", status, err)
		}
		assertCharge(before, 1, "cheap", 0.1)
	})

	t.Run("missing deleted invalid group fails explicitly before upstream", func(t *testing.T) {
		switchGroup("cheap")
		settings.Public.ModelChannel.Pricing.Groups = []model.ModelGroup{{ID: "default", Ratio: 1}, {ID: "premium", Ratio: 2}}
		saveSettings()
		before := balance()
		recorder := call(AIChatCompletions, "cheap-b", nil)
		if !strings.Contains(recorder.Body.String(), "分组不存在") || balance() != before {
			t.Fatalf("deleted: %s", recorder.Body)
		}
		if _, err := service.ResolveModelUsageCost("unpriced", "cheap"); err == nil {
			t.Fatal("unknown group became free unpriced call")
		}
		settings.Public.ModelChannel.Pricing.Groups = []model.ModelGroup{{ID: "default", Ratio: 1}, {ID: "cheap", Ratio: 0}, {ID: "premium", Ratio: 2}}
		saveSettings()
		if _, err := service.WithModelGroupSnapshot(userContext(), auth()); err == nil {
			t.Fatal("invalid ratio silently accepted")
		}
		settings.Public.ModelChannel.Pricing.Groups[1].Ratio = 0.1
		saveSettings()
	})

	t.Run("workflow agent uses selected route and ratio", func(t *testing.T) {
		switchGroup("cheap")
		protocolMockHTTP(t, func(request *http.Request) (*http.Response, error) {
			if request.Header.Get("Authorization") != "Bearer cheap-b-secret" {
				t.Errorf("agent escaped selected group")
			}
			return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(`{"choices":[{"message":{"content":"{\"name\":\"Draft\"}"}}]}`))}, nil
		})
		before := balance()
		result, err := service.DraftCreativeWorkflow(userContext(), service.WorkflowAgentDraftRequest{Prompt: "make a workflow", Model: "group-model", ChannelID: "cheap-b"})
		if err != nil || result.Draft == nil {
			t.Fatalf("agent: %+v %v", result, err)
		}
		assertCharge(before, 1, "cheap", 0.1)
		switchGroup("premium")
		before = balance()
		if _, err := service.DraftCreativeWorkflow(userContext(), service.WorkflowAgentDraftRequest{Prompt: "make a workflow", Model: "group-model", ChannelID: "cheap-b"}); err == nil || before != balance() {
			t.Fatal("agent cross-group pin was accepted")
		}
	})

	t.Run("system image video audio workflows share selected group pricing", func(t *testing.T) {
		channel := model.ModelChannel{ID: "wf-cheap", Name: "Workflow", Protocol: "runninghub", BaseURL: "https://groups.invalid", APIKey: "workflow-secret", Enabled: true, Groups: []string{"cheap"}}
		for _, kind := range []string{"image", "video", "audio"} {
			entry := model.WorkflowEntry{Provider: "runninghub", Kind: "workflow", WorkflowID: "123-" + kind, Title: kind, Capability: kind, Enabled: true}
			channel.Workflows = append(channel.Workflows, entry)
			settings.Public.ModelChannel.ModelCosts = append(settings.Public.ModelChannel.ModelCosts, model.ModelCost{Model: "workflow:system:wf-cheap:workflow:" + entry.WorkflowID, Price: 10, BillingMode: model.BillingModeRequest})
		}
		settings.Private.Channels = append(settings.Private.Channels, channel)
		saveSettings()
		t.Cleanup(func() {
			settings.Private.Channels = settings.Private.Channels[:4]
			settings.Public.ModelChannel.ModelCosts = settings.Public.ModelChannel.ModelCosts[:1]
			saveSettings()
		})
		client := service.SafeProxyHTTPClient()
		previousTransport := client.Transport
		t.Cleanup(func() { client.Transport = previousTransport })
		client.Transport = protocolTransport(func(request *http.Request) (*http.Response, error) {
			payload, _ := io.ReadAll(request.Body)
			if request.URL.Path != "/task/openapi/create" || !strings.Contains(string(payload), "workflow-secret") {
				t.Errorf("wrong workflow route: %s %s", request.URL, payload)
			}
			return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(`{"code":0,"data":{"taskId":"workflow-upstream"}}`))}, nil
		})
		switchGroup("cheap")
		for _, kind := range []string{"image", "video", "audio"} {
			before := balance()
			ref := service.WorkflowRef{Scope: "system", ChannelID: "wf-cheap", Kind: "workflow", WorkflowID: "123-" + kind}
			result, err := service.CreateWorkflowTask(userContext(), auth(), service.WorkflowRunInput{Ref: ref, ExpectedCapability: kind})
			if err != nil || result.Status != "running" {
				t.Fatalf("workflow %s: %+v %v", kind, result, err)
			}
			assertCharge(before, 1, "cheap", 0.1)
			switchGroup("premium")
			before = balance()
			if _, err := service.CreateWorkflowTask(userContext(), auth(), service.WorkflowRunInput{Ref: ref, ExpectedCapability: kind}); err == nil || before != balance() {
				t.Fatalf("workflow %s escaped group", kind)
			}
			switchGroup("cheap")
		}
	})

	t.Run("public settings hide drafts future notices and credentials", func(t *testing.T) {
		settings.Public.Announcements = []model.Announcement{
			{ID: "saved-id", Title: "Published", Content: "Content", Type: "info", Enabled: true, Pinned: true},
			{Title: "Draft", Content: "Draft content", Type: "warning"},
			{ID: "scheduled", Title: "Future", Content: "Future content", Type: "success", Enabled: true, PublishDate: time.Now().Add(time.Hour).Format(time.RFC3339)},
		}
		saved, err := service.SaveSettings(settings)
		if err != nil {
			t.Fatal(err)
		}
		if len(saved.Public.Announcements) != 3 || saved.Public.Announcements[0].ID != "saved-id" || saved.Public.Announcements[1].ID == "" {
			t.Fatalf("saved IDs/drafts: %+v", saved.Public.Announcements)
		}
		settings, err = repository.GetSettings()
		if err != nil {
			t.Fatal(err)
		}
		if len(settings.Private.Channels[3].Groups) != 1 || settings.Private.Channels[3].Groups[0] != "default" {
			t.Fatal("default channel membership was not saved durably")
		}
		public, err := service.PublicSettings()
		if err != nil || len(public.Announcements) != 1 || public.Announcements[0].ID != "saved-id" {
			t.Fatalf("public notices: %+v %v", public.Announcements, err)
		}
		encoded, _ := json.Marshal(public)
		if strings.Contains(string(encoded), "secret") || !strings.Contains(string(encoded), `"groups":["cheap"]`) {
			t.Fatalf("public credentials/groups: %s", encoded)
		}
		admin, err := service.AdminSettings()
		if err != nil || len(admin.Public.Announcements) != 3 {
			t.Fatalf("admin drafts: %+v %v", admin.Public.Announcements, err)
		}
		if _, err := service.SaveSettings(admin); err != nil {
			t.Fatalf("save redacted admin settings: %v", err)
		}
		public, err = service.PublicSettings()
		if err != nil || len(public.ModelChannel.Channels) != 4 {
			t.Fatalf("redacted save dropped routes: %+v %v", public.ModelChannel.Channels, err)
		}
	})

	t.Run("admin rejects malformed notice types dates sizes and duplicates", func(t *testing.T) {
		valid := model.Announcement{ID: "valid", Title: "Title", Content: "Content", Type: "info"}
		for _, change := range []func(*model.Announcement){
			func(n *model.Announcement) { n.Title = "  " }, func(n *model.Announcement) { n.Content = "" },
			func(n *model.Announcement) { n.Type = "error" }, func(n *model.Announcement) { n.PublishDate = "2026-02-30" },
			func(n *model.Announcement) { n.Title = strings.Repeat("字", 201) }, func(n *model.Announcement) { n.Content = strings.Repeat("a", 20001) },
		} {
			invalid := valid
			change(&invalid)
			input := settings
			input.Public.Announcements = []model.Announcement{invalid}
			if _, err := service.SaveSettings(input); err == nil {
				t.Fatalf("accepted invalid notice: %+v", invalid)
			}
		}
		input := settings
		input.Public.Announcements = []model.Announcement{valid, valid}
		if _, err := service.SaveSettings(input); err == nil {
			t.Fatal("accepted duplicate notice IDs")
		}
		request := httptest.NewRequest(http.MethodPut, "/settings", strings.NewReader(`{"public":{"announcements":[{"title":"Title","content":"Content","type":"info","enabled":"false"}]}}`))
		recorder := httptest.NewRecorder()
		AdminSaveSettings(recorder, request)
		if !strings.Contains(recorder.Body.String(), "格式无效") {
			t.Fatalf("bad bool type: %s", recorder.Body)
		}
		public, err := service.PublicSettings()
		if err != nil || len(public.Announcements) != 1 {
			t.Fatalf("invalid update mutated settings: %+v %v", public.Announcements, err)
		}
	})
}
