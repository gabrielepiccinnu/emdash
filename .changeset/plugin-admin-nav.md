---
"emdash": minor
"@emdash-cms/admin": minor
"@emdash-cms/plugin-types": minor
---

Add an optional `admin.nav` presentation layer for plugin admin sidebars, separating route declarations (`admin.pages`) from navigation presentation.

## Motivation

Plugins declare admin pages via `admin.pages` — a flat list of route descriptors. The admin shell turned each declared page into a flat sidebar entry, with no way to express "this is the plugin root" versus "these are child pages". As soon as a plugin grows beyond a single page (overview, content list, usage, settings, logs), the sidebar becomes noisy and loses plugin-level information architecture.

## What changed

`PluginAdminConfig` gains an optional `nav?: PluginAdminNav[]` field. `admin.pages` continues to declare *what pages exist and how they mount*; `admin.nav` declares *how those pages appear in the sidebar*.

```ts
admin: {
  pages: [
    { path: "/", label: "Overview" },
    { path: "/logs", label: "Logs" },
    { path: "/settings", label: "Settings" },
  ],
  nav: [
    { label: "Overview", path: "/" },
    {
      label: "Operations",
      children: [
        { label: "Logs", path: "/logs" },
        { label: "Settings", path: "/settings" },
      ],
    },
  ],
}
```

- `PluginAdminNav` is a union of a leaf (`{ label, icon?, path }`) and a group (`{ label, icon?, children }`). Groups never nest — children must be leaves, capping sidebar depth at **2 levels** to avoid arbitrary deep trees.
- Each leaf's `path` must match a declared `admin.pages` path; mismatched leaves are skipped and groups with no surviving children collapse out.

## Backward compatibility

`admin.nav` is opt-in. When omitted, the sidebar derives the same flat list from `admin.pages` as before — existing plugins are unaffected. The wire manifest (`@emdash-cms/plugin-types`) keeps `nav` loosely typed (`Array<unknown>`) so older runtimes deserialise newer manifests gracefully; core narrows it to the `PluginAdminNav` union.
