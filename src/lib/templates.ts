export type NoteTemplate = {
  id: string;
  name: string;
  /** Relative path pattern; {date} {title} supported */
  pathPattern: string;
  body: string;
};

export const BUILTIN_TEMPLATES: NoteTemplate[] = [
  {
    id: "meeting",
    name: "会议记录",
    pathPattern: "会议/{date}-{title}.md",
    body: `---
title: "{{title}}"
tags: [会议]
status: draft
---

# {{title}}

- 日期：{{date}}
- 参会人：
- 议题：

## 纪要

-

## 待办

- [ ]
`,
  },
  {
    id: "reading",
    name: "读书笔记",
    pathPattern: "读书/{title}.md",
    body: `---
title: "{{title}}"
tags: [读书]
status: draft
---

# {{title}}

## 元信息

- 作者：
- 来源：

## 摘录

>

## 想法

-
`,
  },
  {
    id: "weekly",
    name: "周报",
    pathPattern: "周报/{date}.md",
    body: `---
title: "周报 {{date}}"
tags: [周报]
status: draft
---

# 周报 {{date}}

## 本周完成

-

## 进行中

-

## 下周计划

-
`,
  },
  {
    id: "daily",
    name: "每日笔记",
    pathPattern: "日记/{date}.md",
    body: `---
title: "{{date}}"
tags: [日记]
status: draft
---

# {{date}}

## 今日焦点

-

## 记录

-
`,
  },
];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function formatDateISO(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function applyTemplate(
  tpl: NoteTemplate,
  vars: { title?: string; date?: string }
): { path: string; content: string } {
  const date = vars.date || formatDateISO();
  const title = (vars.title || "未命名").trim() || "未命名";
  const path = tpl.pathPattern.replace(/\{date\}/g, date).replace(/\{title\}/g, title);
  const content = tpl.body.replace(/\{\{date\}\}/g, date).replace(/\{\{title\}\}/g, title);
  return { path, content };
}

export function dailyNoteSpec(d = new Date()) {
  const tpl = BUILTIN_TEMPLATES.find((t) => t.id === "daily")!;
  return applyTemplate(tpl, { date: formatDateISO(d), title: formatDateISO(d) });
}
