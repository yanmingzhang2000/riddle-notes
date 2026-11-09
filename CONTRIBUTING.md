# 贡献指南

感谢你考虑为 Sidecar MVP 做贡献！

## 🤔 如何贡献

### 报告问题

如果你发现了 bug 或有功能建议：

1. 检查 [Issues](https://github.com/yourusername/sidecar-mvp/issues) 是否已有相同问题
2. 如果没有，创建新 Issue：
   - 清晰描述问题
   - 提供复现步骤
   - 说明你的环境（浏览器版本、操作系统等）
   - 附上截图（如果适用）

### 提交代码

1. **Fork 仓库**
   ```bash
   git clone https://github.com/yourusername/sidecar-mvp.git
   cd sidecar-mvp
   ```

2. **创建分支**
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **安装依赖**
   ```bash
   npm install
   ```

4. **开发和测试**
   ```bash
   npm run dev      # 开发模式
   npm run test     # 运行测试
   npm run lint     # 代码检查
   ```

5. **提交更改**
   ```bash
   git add .
   git commit -m "feat: add your feature"
   ```

   提交信息格式：
   - `feat:` 新功能
   - `fix:` 修复 bug
   - `docs:` 文档更新
   - `style:` 代码格式
   - `refactor:` 重构
   - `test:` 测试
   - `chore:` 构建/工具

6. **推送到 GitHub**
   ```bash
   git push origin feature/your-feature-name
   ```

7. **创建 Pull Request**
   - 描述你的更改
   - 关联相关 Issue
   - 等待审查

## 📋 开发规范

### 代码风格

- 使用 TypeScript strict mode
- 遵循 ESLint 规则
- 使用有意义的变量名
- 添加必要的注释

### 测试要求

- 新功能必须添加测试
- 运行 `npm run test` 确保所有测试通过
- 测试覆盖率不低于 80%

### 文档要求

- 更新相关文档
- 新功能需要 README 说明
- API 变更需要更新文档

## 🏗️ 项目结构

```
sidecar-mvp/
├── public/              # 扩展资源
├── src/
│   ├── background/      # Service Worker
│   ├── content/         # Content Scripts
│   ├── sidepanel/       # UI
│   ├── db/              # 数据库
│   └── ai/              # AI 功能
└── tests/               # 测试
```

## 🧪 测试指南

### 运行测试

```bash
# 运行所有测试
npm run test

# 监听模式
npm run test:watch

# UI 模式
npm run test:ui
```

### 编写测试

- 单元测试：测试独立函数和类
- 集成测试：测试模块间交互
- E2E 测试：测试完整流程（计划中）

## 📚 相关文档

- [README.md](README.md) - 项目说明
- [BUILD.md](BUILD.md) - 构建指南
- [DEV_NOTES.md](DEV_NOTES.md) - 开发笔记

## ❓ 有问题？

- 查看 [FAQ](https://github.com/yourusername/sidecar-mvp/wiki/FAQ)
- 提问 [Discussions](https://github.com/yourusername/sidecar-mvp/discussions)
- 发送邮件到 your.email@example.com

## 📜 许可证

提交代码即表示你同意你的贡献将按照 MIT 许可证授权。

---

再次感谢你的贡献！🎉
