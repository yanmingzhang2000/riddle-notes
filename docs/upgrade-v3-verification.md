# v2 → v3 升级验证指南

## 自动验证步骤

1. **构建扩展**：
   ```bash
   npm run build
   ```

2. **加载扩展到 Chrome**：
   - 打开 `chrome://extensions/`
   - 启用"开发者模式"
   - 点击"加载已解压的扩展程序"，选择 `dist` 目录

3. **验证升级逻辑（在 Chrome DevTools Console 执行）**：
   
   打开扩展的 Service Worker 控制台（在 `chrome://extensions/` 里点击扩展的"Service Worker"链接），粘贴并执行以下代码：

   ```javascript
   // 检查当前数据库版本和笔记 uid
   (async () => {
     const { db } = await import('./db/schema.js');
     
     console.log('=== 数据库版本 ===');
     console.log('当前版本:', db.verno);
     
     const prompts = await db.prompts.toArray();
     console.log('\n=== 笔记统计 ===');
     console.log('总笔记数:', prompts.length);
     
     const withUid = prompts.filter(p => p.uid);
     const withType = prompts.filter(p => p.type);
     console.log('有 uid 的笔记:', withUid.length);
     console.log('有 type 的笔记:', withType.length);
     
     if (prompts.length > 0) {
       console.log('\n=== 前 3 条笔记示例 ===');
       prompts.slice(0, 3).forEach((p, i) => {
         console.log(`[${i + 1}] uid: ${p.uid}, type: ${p.type}, title: ${p.title}`);
       });
       
       // 测试 uid 索引查询
       if (withUid.length > 0) {
         const testUid = prompts[0].uid;
         console.log('\n=== uid 索引查询测试 ===');
         const start = performance.now();
         const result = await db.prompts.where('uid').equals(testUid).first();
         const elapsed = performance.now() - start;
         console.log('查询耗时:', elapsed.toFixed(2), 'ms');
         console.log('查询结果:', result ? '✓ 成功' : '✗ 失败');
       }
     }
     
     console.log('\n=== 文件夹和标签 ===');
     const folders = await db.folders.toArray();
     const tags = await db.tags.toArray();
     console.log('文件夹数:', folders.length, folders.map(f => f.name));
     console.log('标签数:', tags.length, tags.map(t => t.name));
   })();
   ```

## 预期结果

### 新用户（全新安装）
- 数据库版本：`3`
- 笔记数：`0`
- 文件夹：`['未分类']`（1 个）
- 标签：`[]`（0 个，不再预置）

### 老用户（从 v2 升级）
- 数据库版本：`3`
- 所有笔记都有 `uid`（UUID v4 格式）和 `type: 'ai'`
- 文件夹和标签保持不变
- uid 索引查询耗时 < 5ms

## 手动升级模拟

如果需要模拟 v2 → v3 升级，可以先回退代码到 v2，安装扩展并添加一些笔记，然后更新到 v3：

1. 切换到 v2 分支（假设有）或手动修改 `schema.ts` 移除 v3 定义
2. 加载扩展，添加几条笔记
3. 切换回 v3 代码
4. 重新加载扩展（Chrome 会自动触发升级）
5. 执行上面的验证脚本

## 性能基准

已通过自动化测试（`tests/performance.test.ts`）验证：
- 1000 条笔记中，通过 uid 索引查询单条记录
- 平均耗时：**0.21ms**
- 最大耗时：**1.13ms**
- ✓ 远低于设计目标 5ms
