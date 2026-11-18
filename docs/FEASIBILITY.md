# Agent Inbox 技術可行性摘要

Agent Inbox 在 Windows 上透過本機 SQLite 資料與 Codex Desktop 的 `codex-ipc` 管道監聽會話。會話清單以唯讀方式取得，即時執行狀態與未讀標記以 Codex 回傳的訊號為準。訊號不足時，狀態顯示為 Unknown。

## 相容性

- Codex 狀態串流支援 v11 和 v13，獨立未讀事件支援 v3。
- 已在 Codex Desktop `26.1111.2228.0` 驗證 v13 的即時監聽與原生未讀訊號。
- Windows x64 可攜版已驗證可直接開啟 EXE、載入介面、接收模擬監聽事件，以及關窗後正常退出。

## Phase 1 P0 整合驗證

- 已在 Windows 實測會話探索、執行狀態切換和原生未讀訊號。
- 已在 Codex Desktop `26.1029.7803.0` 實測非同步選項卡及手動指令核准，並確認請求解除後等待狀態會更新。
- 已在測試環境確認 Codex 會話跳轉，以及 VS Code 開啟一般工作目錄。

### Phase 1 近期變更驗收

- 單元測試涵蓋 v11 與 v13、差異更新、未支援版本與斷線後恢復。
- 隔離的 Electron 測試涵蓋監聽失效提示、資料格式不相容、重連恢復及 Windows 工作列角標。
- `systemError` 的判讀與介面已用模擬事件驗證。

## 已知限制

- Codex Desktop 更新可能改變本機資料格式或通訊協定。請參考 [README 的更新後排解方式](../README.md#after-a-codex-desktop-update)。
- 真實 `systemError`、其他核准類型及 Codex 異常退出仍待更多實測。
- Codex 冷啟動和多視窗跳轉，以及 VS Code 開啟 Git worktree 的情境仍待驗證。

更多實作與驗證方式見 [監聽來源說明](PROVIDERS.md)。
