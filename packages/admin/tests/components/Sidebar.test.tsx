import { PuzzlePiece } from "@phosphor-icons/react";
import { describe, it, expect } from "vitest";

import { buildPluginNavItems } from "../../src/components/Sidebar";

type PluginsMap = Parameters<typeof buildPluginNavItems>[0];
type PluginAdmins = Parameters<typeof buildPluginNavItems>[1];

const reactPlugin = (overrides: Partial<PluginsMap[string]> = {}): PluginsMap[string] => ({
	enabled: true,
	adminMode: "react",
	adminPages: [
		{ path: "/", label: "Overview" },
		{ path: "/settings", label: "Settings" },
	],
	...overrides,
});

const mountedReactAdmins = (paths: string[]): PluginAdmins => ({
	"my-plugin": { pages: Object.fromEntries(paths.map((p) => [p, () => null])) },
});

describe("buildPluginNavItems", () => {
	it("derives a flat list from adminPages when adminNav is omitted (legacy)", () => {
		const items = buildPluginNavItems(
			{ "my-plugin": reactPlugin() },
			mountedReactAdmins(["/", "/settings"]),
			PuzzlePiece,
		);

		expect(items.map((i) => i.to)).toEqual([
			"/plugins/my-plugin/",
			"/plugins/my-plugin/settings",
		]);
		expect(items.every((i) => i.children === undefined)).toBe(true);
	});

	it("uses adminNav presentation tree when present, ignoring adminPages order", () => {
		const items = buildPluginNavItems(
			{
				"my-plugin": reactPlugin({
					adminPages: [
						{ path: "/", label: "Overview" },
						{ path: "/settings", label: "Settings" },
						{ path: "/logs", label: "Logs" },
					],
					adminNav: [
						{ label: "Settings", path: "/settings" },
						{
							label: "Operations",
							children: [
								{ label: "Overview", path: "/" },
								{ label: "Logs", path: "/logs" },
							],
						},
					],
				}),
			},
			mountedReactAdmins(["/", "/settings", "/logs"]),
			PuzzlePiece,
		);

		expect(items).toHaveLength(2);
		expect(items[0]?.label).toBe("Settings");
		expect(items[0]?.to).toBe("/plugins/my-plugin/settings");
		expect(items[0]?.children).toBeUndefined();

		expect(items[1]?.label).toBe("Operations");
		expect(items[1]?.children?.map((c) => c.label)).toEqual(["Overview", "Logs"]);
		expect(items[1]?.children?.map((c) => c.to)).toEqual([
			"/plugins/my-plugin/",
			"/plugins/my-plugin/logs",
		]);
	});

	it("drops nav leaves whose path is not declared in adminPages", () => {
		const items = buildPluginNavItems(
			{
				"my-plugin": reactPlugin({
					adminPages: [{ path: "/", label: "Overview" }],
					adminNav: [
						{ label: "Overview", path: "/" },
						{ label: "Phantom", path: "/does-not-exist" },
					],
				}),
			},
			mountedReactAdmins(["/"]),
			PuzzlePiece,
		);

		expect(items.map((i) => i.label)).toEqual(["Overview"]);
	});

	it("collapses groups whose children are all dropped", () => {
		const items = buildPluginNavItems(
			{
				"my-plugin": reactPlugin({
					adminPages: [{ path: "/", label: "Overview" }],
					adminNav: [
						{ label: "Overview", path: "/" },
						{
							label: "Empty Group",
							children: [
								{ label: "Ghost A", path: "/ghost-a" },
								{ label: "Ghost B", path: "/ghost-b" },
							],
						},
					],
				}),
			},
			mountedReactAdmins(["/"]),
			PuzzlePiece,
		);

		expect(items.map((i) => i.label)).toEqual(["Overview"]);
	});

	it("keeps a group when only some children are mountable", () => {
		const items = buildPluginNavItems(
			{
				"my-plugin": reactPlugin({
					adminPages: [
						{ path: "/", label: "Overview" },
						{ path: "/logs", label: "Logs" },
					],
					adminNav: [
						{
							label: "Operations",
							children: [
								{ label: "Overview", path: "/" },
								{ label: "Logs", path: "/logs" },
								{ label: "Ghost", path: "/ghost" },
							],
						},
					],
				}),
			},
			mountedReactAdmins(["/", "/logs"]),
			PuzzlePiece,
		);

		expect(items).toHaveLength(1);
		expect(items[0]?.children?.map((c) => c.label)).toEqual(["Overview", "Logs"]);
	});

	it("skips disabled plugins entirely", () => {
		const items = buildPluginNavItems(
			{ "my-plugin": reactPlugin({ enabled: false }) },
			mountedReactAdmins(["/", "/settings"]),
			PuzzlePiece,
		);

		expect(items).toEqual([]);
	});

	it("in blocks mode, skips adminPages lookup and trusts declared paths", () => {
		const items = buildPluginNavItems(
			{
				"my-plugin": reactPlugin({
					adminMode: "blocks",
					adminPages: [{ path: "/blocks-page", label: "Blocks Page" }],
					adminNav: [{ label: "Blocks Page", path: "/blocks-page" }],
				}),
			},
			{},
			PuzzlePiece,
		);

		expect(items.map((i) => i.to)).toEqual(["/plugins/my-plugin/blocks-page"]);
	});
});
