# think-meter

一个 [Claude Code mod](https://code.claude.com/docs/zh-CN/plugins/mods/overview)：把终端的计时工具搬上桌面端，并把时间拆开给你看。

[English](./README.md)

终端版 Claude Code 每次回答结束会显示一行 `Cooked for 1m 6s`，但桌面 app 的 Code 标签页（截至 2026 年 10 月）不显示，回答完就不知道这一轮用了多久。think-meter 把这一行补回来，还多给了两边都没有的信息：思考了多久、输出速度、思考中的实时计时，以及在 `/think-stats` 里看时间花在哪里（思考、输出、工具、等待）。在终端里也能用，总时长和官方的口径一致。

每个回答下方，沿用终端那行的写法：

```
✻ Cooked for 55s · thinking 3.9s · 132 tok/s
```

![桌面 app 里回答下方的统计行](docs/turn-line.png)

思考进行中，spinner 旁边会显示实时计时：

```
Pondering · thinking 3s…
```

输入 `/think-stats` 查看本次会话的统计：

```
✻ 12 turns · 6m 41s in all · 24s median
thinking 48s · writing 1m 2s · tools 4m 13s · waiting 38s · other 10s
claude-opus-5-5 · 31 requests · 18,402 output tok · 142 tok/s · 1.2s median wait
```

## 安装

已在 Claude Code 2.1.285（CLI）和 2.1.286（桌面 app）测试。用 `claude --version` 查看你的版本。

> **Mod 功能目前是 early access。** 如果装上后什么都没显示，说明你的环境还没开启 mod。CLI 可以在启动 Claude Code 的环境里设置 `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`。运行 `claude --debug` 可以看到 mod 没加载的原因。

```
/plugin marketplace add Huuuuung/think-meter
/plugin install think-meter@think-meter
```

不安装直接试用：

```bash
git clone https://github.com/Huuuuung/think-meter
claude --plugin-dir ./think-meter
```

## 设置

`/plugin` → **think-meter** → **Configure options**：

| 选项 | 默认 | 作用 |
| :- | :- | :- |
| `showTurnLine` | `true` | 回答下方的统计行 |
| `liveSpinner` | `true` | spinner 旁的实时思考计时 |

## 测量方式

**Cooked for 55s** 是 Claude Code 报告的整轮墙钟时间：从提交 prompt 到回答完毕，和终端那行、以及 [Codex](https://github.com/openai/codex) 的 "Worked for" 是同一个口径。动词从终端那 8 个里选（Baked、Brewed、Churned、Cogitated、Cooked、Crunched、Sautéed、Worked）。

后面跟着：

| 数值 | 计算方式 |
| :- | :- |
| **thinking** | 第一个流事件 → 第一个可见输出（文字或工具调用）；不到 1 秒不显示 |
| **tok/s** | 输出 token ÷ 流式时间（第一个流事件 → 流结束）；回复太短不显示 |

`/think-stats` 把整个会话的时间拆成五段，加起来等于总时长：

| 部分 | 起点 | 终点 |
| :- | :- | :- |
| **thinking** | 第一个流事件 | 第一个可见输出 |
| **writing** | 第一个可见输出 | 流结束（文字和工具参数） |
| **tools** | 工具调用开始 | 工具返回（并行的调用只算一次） |
| **waiting** | 请求发出 | 第一个流事件（排队、读取上下文） |
| **other** | 剩下的部分 | hook、重试、请求之间的间隙 |

另外按模型列出请求数、输出 token（含思考）、tok/s 和等待时间中位数。

模型请求经过 `turn.step` 事件，工具经过 `tool.call` 事件。think-meter 只给它们打时间戳，不修改任何内容。一轮回答的数值是该轮所有请求的总和。

### 注意事项

- **thinking 是近似值。** 很多方案下 Claude Code 默认隐藏思考内容，所以这个 mod 测量的是"流开始到出现可见输出"的等待时间。模型有思考时，这段时间就是思考时间；没思考时接近 0。
- **tok/s 包含思考 token**，因为 API 把它们算作输出 token。
- **很短的回复不显示 tok/s**（显示为 `-`），流式时间不足 0.5 秒时固定开销占比太大，数字没有参考价值。
- **tools 可能包含等你的时间。** Claude Code 请求工具权限时，等你确认的时间可能计入 tools。
- **不统计 subagent**，只统计主对话。subagent 在 Agent 工具里运行，整段时间会算进主对话的 tools。
- mod 重新加载或会话重启后，统计会归零，之前回答下面的统计行也会消失。

## 隐私与权限

Mod 不在沙盒里运行，所以你应该知道它碰了什么。think-meter 只调用这些 API：

```
calls: $.clock.every, $.clock.now, $.command.register, $.ui.invalidate
```

它挂 `turn.step` 和 `tool.call` 只是为了打时间戳；挂 Claude 回复的绘制（`AssistantMessage` 上的 `ui.render`）只是为了在最后一段下面加上统计行，存下来的回复和模型读到的内容都不变。不读写文件、不联网、不启动进程、不读环境变量、不往磁盘存任何东西。内存里保留计时、token 数量和最近几次回答的文字（用来找到统计行该画在哪一段下面），从不记录到别处或发送你的 prompt、回答、思考内容、工具参数或工具结果。可以自己用 `claude plugin validate .claude-plugin/plugin.json` 核实。

## 许可证

[MIT](./LICENSE)
