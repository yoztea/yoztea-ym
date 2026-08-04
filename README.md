# yoztea-ym 柚子姨妈

记录女友姨妈的网页。男友手机增删改,女友只读,无服务器,部署到 GitHub Pages。
风格仿 `sakura-countdown`(粉色系、卡片、樱花瓣、PWA)。

## 同步原理

- 数据存在仓库 `data/period.json`。
- **男友(管理员)**:浏览器 localStorage 存 fine-grained PAT,通过 GitHub Contents API 提交修改。
- **女友(只读)**:无 token,通过 `raw.githubusercontent.com` 拉取最新 JSON,页面每 5 分钟 + 切回前台时自动刷新。raw URL 直接指向 main 分支最新提交,几乎实时,不等 Pages 部署。

## 部署步骤

1. 在 GitHub 新建仓库 `yoztea-ym`(public),把本项目全部文件 push 上去。
2. Settings → Pages → Source = `main` / `root`。等 1~2 分钟,访问 `https://<你的用户名>.github.io/yoztea-ym/` 确认打开。
3. 生成 fine-grained PAT(只在男友手机上用):
   - GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token
   - Resource owner: 自己;Repository access: Only select repositories → 选 `yoztea-ym`
   - Permissions → Repository permissions → Contents: **Read and write**
   - 复制 token(`github_pat_…` 开头)
4. 男友手机打开网站 → 右上角齿轮 → 填 `owner/repo`(如 `yoztea/yoztea-ym`)和 token → 保存。此时出现 + 按钮 = 管理员模式。
5. 把网站链接发给女友。女友打开即只读,无需任何配置。

> origin 推断:如果是从 `username.github.io/yoztea-ym` 打开,仓库会自动识别,女友端无需手动填。

## 安全说明

- PAT 仅存在男友手机的浏览器 localStorage,不上传任何第三方服务器,只直连 GitHub 官方 API。
- fine-grained + 单仓库 + 只 Contents 权限,爆炸半径被限制到最小。即便泄露也只能改这一个仓库的 JSON 文件。
- token 不要分享给女友(否则她也能改,虽然也无害);丢了立刻在 GitHub 撤销重生成。
- 仓库建议设为 public 以便女友无 token 读取。若想私有,女友也得加 PAT 读权限,体验下降。

## 数据格式 `data/period.json`

```json
{
  "periods": [
    { "id": "1690000000000-abc123", "start": "2026-07-01", "end": "2026-07-06", "flow": "medium", "note": "痛经" }
  ],
  "updatedAt": "2026-08-04T10:00:00Z"
}
```

字段:`start`/`end`(YYYY-MM-DD)、`flow`(light/medium/heavy)、`note`(自由文本)。

## 周期计算

- 平均周期 = 相邻 start 之差的平均;不足 2 条记录默认 28 天。
- 今天落在某条 `[start, end]` 区间 → 显示「姨妈第 X 天」+ 樱花瓣飘落。
- 否则用最后一条 start + 平均周期预测下次,显示「距下次姨妈还有 X 天」。

## 本地预览

```bash
cd E:/my_code/yoztea-ym
python -m http.server 8000
# 浏览器打开 http://localhost:8000/
```

未填 token = 只读模式,可看 UI 但无法保存。完整测试需配置真实仓库和 PAT。
