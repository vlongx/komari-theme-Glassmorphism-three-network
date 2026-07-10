# 上传到 GitHub

## 1. 新建仓库

在 GitHub 新建一个空仓库，例如：

```text
komari-theme-Glassmorphism-three-network
```

不要勾选自动创建 README、License 或 .gitignore。

## 2. 本地上传

解压本源码包后，在项目根目录执行：

```bash
git init
git add .
git commit -m "feat: add China carrier ping panels"
git branch -M main
git remote add origin https://github.com/YOUR_NAME/komari-theme-Glassmorphism-three-network.git
git push -u origin main
```

## 3. 自动生成 Release

项目内的 `.github/workflows/release-on-version-bump.yml` 会读取 `komari-theme.json` 的版本号。首次推送后，GitHub Actions 会安装依赖、构建主题、创建 `v2.4.0` 标签和 Release，并上传可导入 Komari 的构建 ZIP。

后续发布新版本时，只需要修改 `komari-theme.json` 顶层的 `version`，提交并推送到 main。

## 4. Komari Ping 任务命名

建议创建三个 Ping 任务并命名为：

```text
联通
电信
移动
```

也兼容：Unicom/CUCC、Telecom/CTCC/ChinaNet/CN2、Mobile/CMCC/CMI/CMIN2。
