# DSH 本地插件开发必须使用 link 协议

## 现象

DSH Web profile 使用 `file:D:/path/to/plugin` 安装本地插件时，`pnpm update --force` 可能只刷新 `package.json` 版本和已有文件，而不物化新加入的源码文件。运行时会出现版本看似正确，但 import 新模块时报 `ERR_MODULE_NOT_FOUND`。

## 根因

`file:` 依赖会经过 pnpm 的本地包快照与内容寻址缓存。插件版本变化不保证目录中新文件被重新复制到 profile 的 `node_modules`。这会形成“版本已升级、包内容仍旧”的假升级。

## 约定

本机持续开发的 DSH 插件统一使用：

```json
{
  "dependencies": {
    "dsh-smart-model-router": "link:D:/dsh/dsh-smart-model-router",
    "dsh-provider-capacity": "link:D:/dsh/dsh-provider-capacity"
  }
}
```

修改 profile 后执行一次 `pnpm install`。安装完成后，`node_modules` 条目应直接指向插件仓库目录。

正式 npm 发布或其他机器安装仍使用正常版本号；`link:` 只用于本机开发 profile，不写入插件发布包。

## 验收

- `node_modules/<plugin>` 的链接目标是源码仓库。
- 新增模块文件可以从 profile 中直接访问。
- DSH 重启后插件正常加载。
- 运行接口返回插件当前版本和最新 schema。

