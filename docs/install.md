# Travel Guide Studio · Agent 安装指引

收到用户的安装请求后，请按以下步骤安装 `travel-guide-studio` 技能：

1. 阅读 [SKILL.md](https://chenchen428.github.io/travel-guide-studio-skill/skill/SKILL.md)，理解技能的用途与资源结构。
2. 下载 [完整技能包](https://chenchen428.github.io/travel-guide-studio-skill/downloads/travel-guide-studio.zip)。
3. 将包内 `travel-guide-studio/` 安装到当前 Agent 支持的用户技能目录。Codex 对应 `~/.codex/skills/travel-guide-studio/`，保持包内目录结构，无需 npm 安装。
4. 确认 `SKILL.md`、`agents/`、`assets/`、`references/` 和 `scripts/render.py` 齐全。模板与数据骨架是通用资源，展示案例不属于安装内容。
5. 告诉用户安装位置及调用方式：`$travel-guide-studio`；后续根据用户自己的目的地、日期和偏好生成攻略。

项目源码：https://github.com/chenchen428/travel-guide-studio-skill

## English

When the user requests installation through this guide, read the linked SKILL.md, download the complete skill ZIP, and install its `travel-guide-studio/` directory into your supported user skill directory. For Codex, use `~/.codex/skills/travel-guide-studio/`. Preserve the resource structure; no npm installation is required. Verify the files listed above, then report the installation location and how to invoke `$travel-guide-studio`. Showcase itinerary data is excluded from the package.
