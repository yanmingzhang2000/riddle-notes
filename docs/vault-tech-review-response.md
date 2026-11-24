# Vault 技术方案评审回应

主文档：`docs/vault-technical-architecture.md`（当前 v1.2）。`vault-technical-architecture-v1.0.md` 是最初版本的备份。

**状态说明**：下面表格里的"v1.2 处理"描述的是**文档**当时怎么改的。写这份回应时 `src/` 下还没有 Vault 代码；后来 Task 1.1–1.3、2.1 已实现并有测试（`tests/vault/`，388 个用例），代码是否对应以主文档 §7 的勾选为准，不以这张表为准。

---

## 第二轮评审：Approved with comments

### 更正上一版回应中的不准确之处

| 上一版的说法 | 实际情况 |
|------|------|
| "乐观锁已实现（比对 updatedAt）" | v1.1 代码只读 `revision` 再 +1，没有和期望值比较。v1.2 改为事务外记 `expectedRevision`，事务内比对（§2.3） |
| "VaultGuard 死循环已修复" | v1.1 的 §6.3 与 v1.0 完全一致，没改。v1.2 把 `setup`/`unlock`/`recover` 移到守卫外，并加 `loading` 状态（§6.3） |
| "已实现：锁定时清除剪贴板" | 只是示例代码。且该机制只能尽力而为，v1.2 明确不作验收项（§4.5） |
| "区分密码错误和数据损坏" | AES-GCM 做不到。v1.2 改为三类错误（§5.3） |
| 问题编号 | 评审清单没有"问题 20"；上一版的编号对应有误，本表按内容对应 |

### 本轮需要先改的 5 处 + 其余问题

| # | 问题 | v1.2 处理 | 位置 |
|---|------|------|------|
| 1 | HKDF 派生 key 的 usages 是 `wrapKey/unwrapKey`，与 `encrypt/decrypt` 调用不符，初始化会抛 `InvalidAccessError` | 改为 `['encrypt','decrypt']`；Task 1.2 加测试 | §2.2、§9.1 |
| 2 | 乐观锁缺失；`keyId` 只在风险表里 | `VaultKeyWrapper` 加 `keyId`、`revision`；所有改 wrapper 的操作统一"事务外加解密 + 短事务比对 revision"；记录写入比对 `keyId` | §2.1、§2.3、§5.2 |
| 3 | `lock()` 广播后收到方又 `lock()` 再广播，无限循环；`wrapper-changed` 无发送方 | 拆成 `lock()` 与 `lockLocal()`，`onmessage` 只调后者；`announce()` 在改密码、recover、导入提交后调用 | §4.2 |
| 4 | `recoverWithKey` 步骤二失败返回错误状态 | 拆成 `recoverAccess`（步骤一提交后立即返回）与独立的 `rotateRecoveryKey` | §2.4、§5.2 |
| 5 | Session 接口与调用方对不上；`extractable:false` 达不到；改密码触发 `epoch++` | Session 统一入口 `open(key, keyId)`；`unwrap` 返回原始字节；新增不碰 Session 的 `verifyMasterPassword` | §4.2、§4.6、§5 |
| 6 | VaultGuard 死循环；`VaultGuard` 与 `VaultRoot` 职责重复 | 见上；`VaultShell` 只管 `key={epoch}`，`VaultGuard` 只管路由 | §6.3 |
| 7 | "区分密码错误和数据损坏"做不到 | 三类：结构损坏、输入有误、认证失败；§8 里相反的说法一并删除 | §5.3、§8 R9 |
| 8 | Recovery Key 格式前后矛盾 | 定稿：`RN-V1-` + 13 组数据 + 1 组校验，共 75 字符、15 个连字符；SHA-256 前 20 bit 做校验；解码要求末字符填充位为 0；三组固定测试向量 | §2.2 |
| 9 | 旧内容残留（§2.1、§2.3、§3、§8、§9、§14、附录） | §2–§9、§11–§14、附录整体重写；`vaultSnapshot` 并入 `RiddleVaultDB` v1 | 全文 |
| 10 | AAD、IV 长度校验、字节清零不能放到"实现中" | 写入 Task 1.2，并加"篡改 type / 换记录 / 互换 segment 必须失败"的测试 | §3.2、§7 |
| 11 | 锁定时清剪贴板只能尽力而为 | 写明尽力而为，从验收项移除；三处说法统一 | §4.5、§8 R8、§13 C |
| 12 | Argon2id spike 顺序放错 | 前移为 Task 1.0，先于 1.2；`KdfParams` 联合类型在接口里先定义 | §1.2、§7 |
| — | 最低主密码强度 | Task 3.1：长度 ≥ 12 且 zxcvbn 得分 ≥ 3 | §6.2、§7 |

### 本轮实际验证过的内容

- 用 `node:crypto` 计算并核对了 Recovery Key 的三组测试向量，和文档里的字符串逐字一致。
- 验证了规范里的拒绝规则：非字母表字符、缺组、错前缀、校验和不符都被拒绝；填充位非 0 的字符串即使校验和合法也会被拒绝，而不拒绝的话它会解出和原串相同的 Key。
- `npm view` 确认 `argon2-browser` 最后发布于 2022-04，`hash-wasm`、`@noble/hashes` 近几个月仍有更新。
- 仓库已有 `fake-indexeddb` 与 vitest，测试环境不需要新增依赖。

### 仍未验证

- Side Panel 关闭是否真的销毁页面（Task 1.0 spike）。
- Argon2id 在低端设备上的实际耗时，以及 WASM 在 Chrome 的 Side Panel / Worker 里能否在 `'wasm-unsafe-eval'` 下实例化（Task 1.0 spike）。本机 Node 基准和 manifest 构建试验已做，结果在主文档 §7 Task 1.0，但那不是低端设备，也不是 Chrome。
- 解锁页不用 `<form>` 是否就不会触发浏览器"保存密码"提示。
- 工时估算与评审一致（230–300h），未重新估算。

---

## 第一轮评审（v1.0 → v1.1）摘要

- 初始化：存在性检查、回填校验后才提交、去掉 `initialized` 字段
- Recovery 拆为两步，新主密码先提交
- Recovery Key 改为 256 bit，HKDF 派生
- 主密码 NFKC 规范化
- 记录拆成 summary / secret 两段加密
- Epoch 机制、独立 `RiddleVaultDB`、"关闭即锁定"
