/**
 * Menu Editor component
 *
 * Edit menu items with drag-and-drop reordering and nesting.
 * - Drag vertically to reorder.
 * - Drag right (> 50 px) to nest an item under the one above it.
 * - Drag left (> 50 px) to promote a sub-item back to top level.
 * - Use ← → buttons for keyboard-accessible nesting.
 */

import { Button, Dialog, Input, Select, Toast } from "@cloudflare/kumo";
import { useLingui } from "@lingui/react/macro";
import {
	DndContext,
	DragOverlay,
	KeyboardSensor,
	PointerSensor,
	closestCenter,
	useSensor,
	useSensors,
	type DragCancelEvent,
	type DragEndEvent,
	type DragMoveEvent,
	type DragStartEvent,
} from "@dnd-kit/core";
import {
	SortableContext,
	arrayMove,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
	Plus,
	Trash,
	CaretUp,
	CaretDown,
	DotsSixVertical,
	Link as LinkIcon,
	ArrowLeft,
	ArrowRight,
	X,
	File as FileIcon,
} from "@phosphor-icons/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useNavigate } from "@tanstack/react-router";
import * as React from "react";

import {
	fetchMenu,
	createMenuItem,
	deleteMenuItem,
	updateMenuItem,
	reorderMenuItems,
	type MenuItem,
} from "../lib/api";
import { ArrowPrev } from "./ArrowIcons.js";
import { ContentPickerModal } from "./ContentPickerModal";
import { DialogError, getMutationError } from "./DialogError.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FlatItem {
	item: MenuItem;
	/** 0 = top-level, 1 = sub-item (max one level of nesting) */
	depth: number;
}

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

/**
 * Build a display list in tree-walk order from a flat MenuItem array.
 * Each root item is followed immediately by its children.
 */
function buildDisplayList(items: MenuItem[]): FlatItem[] {
	const result: FlatItem[] = [];
	const roots = items
		.filter((i) => !i.parent_id)
		.toSorted((a, b) => a.sort_order - b.sort_order);

	for (const root of roots) {
		result.push({ item: root, depth: 0 });
		const children = items
			.filter((i) => i.parent_id === root.id)
			.toSorted((a, b) => a.sort_order - b.sort_order);
		for (const child of children) {
			result.push({ item: child, depth: 1 });
		}
	}
	return result;
}

/**
 * Convert a display list back to the reorder API payload.
 * parentId is derived from depth: depth-0 → null, depth-1 → nearest preceding depth-0 item.
 * sortOrder is assigned sequentially within each parent group.
 */
function toPayload(
	list: FlatItem[],
): Array<{ id: string; parentId: string | null; sortOrder: number }> {
	const result: Array<{ id: string; parentId: string | null; sortOrder: number }> = [];
	const counters = new Map<string | null, number>();
	let currentRootId: string | null = null;

	for (const { item, depth } of list) {
		const parentId = depth === 0 ? null : currentRootId;
		if (depth === 0) currentRootId = item.id;

		const sortOrder = counters.get(parentId) ?? 0;
		counters.set(parentId, sortOrder + 1);
		result.push({ id: item.id, parentId, sortOrder });
	}
	return result;
}

/**
 * After a drag-and-drop reorder, fix any sub-items that ended up before their
 * parent (orphans). Orphaned sub-items are promoted to top-level.
 */
function fixOrphans(list: FlatItem[]): FlatItem[] {
	const fixed = [...list];
	let hasRoot = false;
	for (let i = 0; i < fixed.length; i++) {
		const cur = fixed[i];
		if (!cur) continue;
		if (cur.depth === 0) {
			hasRoot = true;
		} else if (cur.depth === 1 && !hasRoot) {
			fixed[i] = { item: cur.item, depth: 0 };
			hasRoot = true;
		}
	}
	return fixed;
}

// ---------------------------------------------------------------------------
// SortableMenuItem — one row in the list
// ---------------------------------------------------------------------------

interface SortableMenuItemProps {
	flatItem: FlatItem;
	idx: number;
	displayList: FlatItem[];
	onMoveUp: () => void;
	onMoveDown: () => void;
	onIndent: () => void;
	onOutdent: () => void;
	onEdit: () => void;
	onDelete: () => void;
	isFirstInGroup: boolean;
	isLastInGroup: boolean;
	canIndent: boolean;
}

function SortableMenuItemRow({
	flatItem,
	idx: _idx,
	onMoveUp,
	onMoveDown,
	onIndent,
	onOutdent,
	onEdit,
	onDelete,
	isFirstInGroup,
	isLastInGroup,
	canIndent,
}: SortableMenuItemProps) {
	const { item, depth } = flatItem;
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id: item.id,
	});

	const style: React.CSSProperties = {
		transform: CSS.Transform.toString(transform),
		transition,
		marginLeft: depth === 1 ? "2rem" : "0",
	};

	return (
		<div
			ref={setNodeRef}
			style={style}
			className={`border rounded-lg p-4 flex items-center gap-3 bg-kumo-base${isDragging ? " opacity-40" : ""}`}
		>
			{/* Drag handle */}
			<button
				{...attributes}
				{...listeners}
				className="cursor-grab active:cursor-grabbing shrink-0 text-kumo-subtle hover:text-kumo-foreground"
				aria-label={`Drag to reorder ${item.label}`}
			>
				<DotsSixVertical className="h-4 w-4" />
			</button>

			{/* Label / meta */}
			<div className="flex items-center gap-2 flex-1 min-w-0">
				{depth === 1 && (
					<span className="text-kumo-subtle shrink-0 select-none" aria-hidden>
						↳
					</span>
				)}
				<div className="min-w-0">
					<div className="font-medium truncate">{item.label}</div>
					<div className="text-sm text-kumo-subtle truncate">
						{item.type === "custom" ? (
							item.custom_url
						) : (
							<span className="inline-flex items-center rounded-full bg-kumo-brand/10 px-2 py-0.5 text-xs font-medium text-kumo-brand">
								{item.reference_collection ?? item.type}
							</span>
						)}
						{item.target === "_blank" && " (opens in new window)"}
					</div>
				</div>
			</div>

			{/* Controls */}
			<div className="flex gap-1 shrink-0">
				<Button
					variant="ghost"
					size="sm"
					aria-label="Move up"
					onClick={onMoveUp}
					disabled={isFirstInGroup}
				>
					<CaretUp className="h-4 w-4" />
				</Button>
				<Button
					variant="ghost"
					size="sm"
					aria-label="Move down"
					onClick={onMoveDown}
					disabled={isLastInGroup}
				>
					<CaretDown className="h-4 w-4" />
				</Button>

				{/* Indent → nest under item above */}
				<Button
					variant="ghost"
					size="sm"
					aria-label="Make sub-item"
					title="Nest under the item above"
					onClick={onIndent}
					disabled={!canIndent}
				>
					<ArrowRight className="h-4 w-4" />
				</Button>

				{/* Outdent → promote to top level */}
				<Button
					variant="ghost"
					size="sm"
					aria-label="Make top-level item"
					title="Promote to top level"
					onClick={onOutdent}
					disabled={depth !== 1}
				>
					<ArrowLeft className="h-4 w-4" />
				</Button>

				<Button variant="outline" size="sm" onClick={onEdit}>
					Edit
				</Button>
				<Button variant="outline" size="sm" aria-label="Delete" onClick={onDelete}>
					<Trash className="h-4 w-4" />
				</Button>
			</div>
		</div>
	);
}

/** Lightweight ghost shown in DragOverlay. Reflects the proposed nesting depth. */
function DragPreview({ flatItem, proposedDepth }: { flatItem: FlatItem; proposedDepth: number }) {
	const { item } = flatItem;
	const effectiveDepth = proposedDepth;
	return (
		<div
			className="border-2 border-kumo-brand rounded-lg p-4 flex items-center gap-3 bg-kumo-base shadow-xl"
			style={{ marginLeft: effectiveDepth === 1 ? "2rem" : "0" }}
		>
			<DotsSixVertical className="h-4 w-4 text-kumo-subtle shrink-0" />
			<div className="flex items-center gap-2">
				{effectiveDepth === 1 && (
					<span className="text-kumo-subtle select-none" aria-hidden>
						↳
					</span>
				)}
				<span className="font-medium">{item.label}</span>
				{effectiveDepth === 1 && (
					<span className="text-xs text-kumo-brand font-medium">sub-item</span>
				)}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// MenuEditor
// ---------------------------------------------------------------------------

export function MenuEditor() {
	const { t } = useLingui();
	const { name } = useParams({ from: "/_admin/menus/$name" });
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const toastManager = Toast.useToastManager();
	const [isAddOpen, setIsAddOpen] = React.useState(false);
	const [isContentPickerOpen, setIsContentPickerOpen] = React.useState(false);
	const [editingItem, setEditingItem] = React.useState<MenuItem | null>(null);
	const [displayList, setDisplayList] = React.useState<FlatItem[]>([]);
	const [activeId, setActiveId] = React.useState<string | null>(null);
	const [proposedDepth, setProposedDepth] = React.useState(0);
	// Ref keeps the latest proposedDepth accessible in handleDragEnd without stale closure issues
	const proposedDepthRef = React.useRef(0);
	const [addError, setAddError] = React.useState<string | null>(null);
	const [editError, setEditError] = React.useState<string | null>(null);

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	);

	const { data: menu, isLoading } = useQuery({
		queryKey: ["menu", name],
		queryFn: () => fetchMenu(name),
		staleTime: Infinity,
	});

	React.useEffect(() => {
		if (menu?.items) {
			setDisplayList(buildDisplayList(menu.items));
		}
	}, [menu]);

	// ── Mutations ────────────────────────────────────────────────────────────

	const createMutation = useMutation({
		mutationFn: (input: Parameters<typeof createMenuItem>[1]) => createMenuItem(name, input),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["menu", name] });
			setIsAddOpen(false);
			toastManager.add({ title: t`Item added`, description: t`Menu item has been added.` });
		},
		onError: (error: Error) => {
			setAddError(error.message);
		},
	});

	const deleteMutation = useMutation({
		mutationFn: (itemId: string) => deleteMenuItem(name, itemId),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["menu", name] });
			toastManager.add({
				title: t`Item deleted`,
				description: t`Menu item has been deleted.`,
			});
		},
		onError: (error: Error) => {
			toastManager.add({
				title: t`Error`,
				description: error.message,
				type: "error",
			});
		},
	});

	const updateMutation = useMutation({
		mutationFn: ({
			itemId,
			input,
		}: {
			itemId: string;
			input: Parameters<typeof updateMenuItem>[2];
		}) => updateMenuItem(name, itemId, input),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["menu", name] });
			setEditingItem(null);
			toastManager.add({
				title: t`Item updated`,
				description: t`Menu item has been updated.`,
			});
		},
		onError: (error: Error) => {
			setEditError(error.message);
		},
	});

	const reorderMutation = useMutation({
		mutationFn: (input: Parameters<typeof reorderMenuItems>[1]) => reorderMenuItems(name, input),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["menu", name] });
			toastManager.add({
				title: t`Order saved`,
				description: t`Menu order has been updated.`,
			});
		},
		onError: (error: Error) => {
			toastManager.add({
				title: t`Error`,
				description: error.message,
				type: "error",
			});
		},
	});

	// ── Reorder helpers ──────────────────────────────────────────────────────

	function applyReorder(newList: FlatItem[]) {
		setDisplayList(newList);
		reorderMutation.mutate({ items: toPayload(newList) });
	}

	function handleDragStart({ active }: DragStartEvent) {
		setActiveId(String(active.id));
		const current = displayList.find((f) => f.item.id === active.id);
		const initialDepth = current?.depth ?? 0;
		proposedDepthRef.current = initialDepth;
		setProposedDepth(initialDepth);
	}

	/**
	 * Track horizontal movement during drag to propose a nesting depth change.
	 * > +50 px right  → propose depth 1 (nest under item above)
	 * > +50 px left   → propose depth 0 (promote to top level)
	 */
	function handleDragMove({ delta }: DragMoveEvent) {
		const next = delta.x > 50 ? 1 : delta.x < -50 ? 0 : proposedDepthRef.current;
		proposedDepthRef.current = next;
		setProposedDepth(next);
	}

	function handleDragCancel(_event: DragCancelEvent) {
		setActiveId(null);
		proposedDepthRef.current = 0;
		setProposedDepth(0);
	}

	function handleDragEnd({ active, over }: DragEndEvent) {
		const depth = proposedDepthRef.current;
		setActiveId(null);
		proposedDepthRef.current = 0;
		setProposedDepth(0);

		if (!over || active.id === over.id) return;

		const oldIndex = displayList.findIndex((f) => f.item.id === active.id);
		const newIndex = displayList.findIndex((f) => f.item.id === over.id);
		if (oldIndex === -1 || newIndex === -1) return;

		// Items with children cannot be nested (would create depth > 1)
		const activeHasChildren =
			oldIndex + 1 < displayList.length && (displayList[oldIndex + 1]?.depth ?? 0) > 0;

		const moved = arrayMove(displayList, oldIndex, newIndex);
		const movedIdx = moved.findIndex((f) => f.item.id === active.id);

		if (movedIdx !== -1) {
			const movedItem = moved[movedIdx];
			if (movedItem) {
				const hasPrecedingRoot = moved.slice(0, movedIdx).some((f) => f.depth === 0);
				const finalDepth = depth === 1 && hasPrecedingRoot && !activeHasChildren ? 1 : 0;
				moved[movedIdx] = { item: movedItem.item, depth: finalDepth };
			}
		}

		applyReorder(fixOrphans(moved));
	}

	function moveItem(idx: number, direction: "up" | "down") {
		const list = displayList;
		const cur = list[idx];
		if (!cur) return;
		const { depth } = cur;

		if (depth === 0) {
			const blockStart = idx;
			let blockEnd = idx;
			while (blockEnd + 1 < list.length && (list[blockEnd + 1]?.depth ?? 0) > 0) blockEnd++;

			if (direction === "up") {
				let prevRootIdx = idx - 1;
				while (prevRootIdx >= 0 && (list[prevRootIdx]?.depth ?? 0) > 0) prevRootIdx--;
				if (prevRootIdx < 0) return;

				applyReorder([
					...list.slice(0, prevRootIdx),
					...list.slice(blockStart, blockEnd + 1),
					...list.slice(prevRootIdx, blockStart),
					...list.slice(blockEnd + 1),
				]);
			} else {
				const nextRootIdx = blockEnd + 1;
				if (nextRootIdx >= list.length || list[nextRootIdx]?.depth !== 0) return;

				let nextBlockEnd = nextRootIdx;
				while (nextBlockEnd + 1 < list.length && (list[nextBlockEnd + 1]?.depth ?? 0) > 0)
					nextBlockEnd++;

				applyReorder([
					...list.slice(0, blockStart),
					...list.slice(nextRootIdx, nextBlockEnd + 1),
					...list.slice(blockStart, blockEnd + 1),
					...list.slice(nextBlockEnd + 1),
				]);
			}
		} else {
			const target = direction === "up" ? idx - 1 : idx + 1;
			if (target < 0 || target >= list.length || list[target]?.depth !== 1) return;

			const newList = [...list];
			const a = newList[idx];
			const b = newList[target];
			if (!a || !b) return;
			newList[idx] = b;
			newList[target] = a;
			applyReorder(newList);
		}
	}

	function indent(idx: number) {
		const list = displayList;
		const cur = list[idx];
		if (!cur || cur.depth !== 0) return;

		let prevRootIdx = idx - 1;
		while (prevRootIdx >= 0 && (list[prevRootIdx]?.depth ?? 0) > 0) prevRootIdx--;
		if (prevRootIdx < 0) return;

		const hasChildren = idx + 1 < list.length && (list[idx + 1]?.depth ?? 0) > 0;
		if (hasChildren) return;

		const newItem: FlatItem = { item: cur.item, depth: 1 };
		const newList = list.filter((_, i) => i !== idx);

		let insertIdx = prevRootIdx + 1;
		while (insertIdx < newList.length && (newList[insertIdx]?.depth ?? 0) > 0) insertIdx++;

		newList.splice(insertIdx, 0, newItem);
		applyReorder(newList);
	}

	function outdent(idx: number) {
		const list = displayList;
		const cur = list[idx];
		if (!cur || cur.depth !== 1) return;

		let parentIdx = idx - 1;
		while (parentIdx >= 0 && (list[parentIdx]?.depth ?? -1) !== 0) parentIdx--;
		if (parentIdx < 0) return;

		const newItem: FlatItem = { item: cur.item, depth: 0 };
		const newList = list.filter((_, i) => i !== idx);

		let insertIdx = parentIdx + 1;
		while (insertIdx < newList.length && (newList[insertIdx]?.depth ?? 0) > 0) insertIdx++;

		newList.splice(insertIdx, 0, newItem);
		applyReorder(newList);
	}

	// ── Derived state ────────────────────────────────────────────────────────

	function isFirstInGroup(idx: number): boolean {
		const cur = displayList[idx];
		if (!cur) return true;
		if (cur.depth === 0) return !displayList.slice(0, idx).some((f) => f.depth === 0);
		return idx > 0 && displayList[idx - 1]?.depth === 0;
	}

	function isLastInGroup(idx: number): boolean {
		const cur = displayList[idx];
		if (!cur) return true;
		if (cur.depth === 0) return !displayList.slice(idx + 1).some((f) => f.depth === 0);
		return idx + 1 >= displayList.length || displayList[idx + 1]?.depth === 0;
	}

	function canIndent(idx: number): boolean {
		const cur = displayList[idx];
		if (!cur || cur.depth !== 0) return false;
		if (!displayList.slice(0, idx).some((f) => f.depth === 0)) return false;
		return !(idx + 1 < displayList.length && (displayList[idx + 1]?.depth ?? 0) > 0);
	}

	// ── Form handlers ────────────────────────────────────────────────────────

	const handleAddCustomLink = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		setAddError(null);
		const fd = new FormData(e.currentTarget);
		createMutation.mutate({
			type: "custom",
			label: String(fd.get("label") ?? ""),
			customUrl: String(fd.get("url") ?? ""),
			target: String(fd.get("target") ?? "") || undefined,
		});
	};

	const handleAddContent = (item: { collection: string; id: string; title: string }) => {
		createMutation.mutate({
			type: item.collection,
			label: item.title,
			referenceCollection: item.collection,
			referenceId: item.id,
		});
	};

	const handleUpdateItem = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		setEditError(null);
		if (!editingItem) return;
		const fd = new FormData(e.currentTarget);
		updateMutation.mutate({
			itemId: editingItem.id,
			input: {
				label: String(fd.get("label") ?? ""),
				customUrl: editingItem.type === "custom" ? String(fd.get("url") ?? "") : undefined,
				target: String(fd.get("target") ?? "") || undefined,
			},
		});
	};

	// ── Render ───────────────────────────────────────────────────────────────

	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-64">
				<div className="text-kumo-subtle">{t`Loading menu...`}</div>
			</div>
		);
	}

	if (!menu) {
		return (
			<div className="text-center py-12">
				<p className="text-kumo-subtle">{t`Menu not found`}</p>
			</div>
		);
	}

	const activeItem = activeId ? (displayList.find((f) => f.item.id === activeId) ?? null) : null;

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-4">
					<Button
						variant="ghost"
						size="sm"
						aria-label={t`Back`}
						onClick={() => navigate({ to: "/menus" })}
					>
						<ArrowPrev className="h-4 w-4" />
					</Button>
					<div>
						<h1 className="text-3xl font-bold">{menu.label}</h1>
						<p className="text-kumo-subtle">{t`Drag to reorder · use ← → to nest items`}</p>
					</div>
				</div>
				<div className="flex gap-2">
					<Button
						icon={<FileIcon />}
						variant="outline"
						onClick={() => setIsContentPickerOpen(true)}
					>
						{t`Add Content`}
					</Button>
					<Dialog.Root
						open={isAddOpen}
						onOpenChange={(open) => {
							setIsAddOpen(open);
							if (!open) setAddError(null);
						}}
					>
						<Dialog.Trigger
							render={(props) => (
								<Button {...props} icon={<Plus />}>
									{t`Add Custom Link`}
								</Button>
							)}
						/>
						<Dialog className="p-6" size="lg">
							<div className="flex items-start justify-between gap-4 mb-4">
								<Dialog.Title className="text-lg font-semibold leading-none tracking-tight">
									{t`Add Custom Link`}
								</Dialog.Title>
								<Dialog.Close
									aria-label={t`Close`}
									render={(props) => (
										<Button
											{...props}
											variant="ghost"
											shape="square"
											aria-label={t`Close`}
											className="absolute end-4 top-4"
										>
											<X className="h-4 w-4" />
											<span className="sr-only">{t`Close`}</span>
										</Button>
									)}
								/>
							</div>
							<form onSubmit={handleAddCustomLink} className="space-y-4">
								<Input label={t`Label`} name="label" required placeholder={t`Home`} />
								<Input
									label={t`URL`}
									name="url"
									type="text"
									required
									pattern="(https?://.+|/.*)"
									title={t`Enter a URL (https://…) or a relative path (/…)`}
									placeholder={t`https://example.com or /about`}
								/>
								<Select
									label={t`Target`}
									name="target"
									defaultValue=""
									items={{ "": t`Same window`, _blank: t`New window` }}
								>
									<Select.Option value="">{t`Same window`}</Select.Option>
									<Select.Option value="_blank">{t`New window`}</Select.Option>
								</Select>
								<DialogError message={addError || getMutationError(createMutation.error)} />
								<div className="flex justify-end gap-2">
									<Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>
										{t`Cancel`}
									</Button>
									<Button type="submit" disabled={createMutation.isPending}>
										{createMutation.isPending ? t`Adding...` : t`Add`}
									</Button>
								</div>
							</form>
						</Dialog>
					</Dialog.Root>
				</div>
			</div>

			<ContentPickerModal
				open={isContentPickerOpen}
				onOpenChange={setIsContentPickerOpen}
				onSelect={handleAddContent}
			/>

			{/* Item list */}
			{displayList.length === 0 ? (
				<div className="border rounded-lg p-12 text-center">
					<LinkIcon className="mx-auto h-12 w-12 text-kumo-subtle mb-4" />
					<h3 className="text-lg font-semibold mb-2">{t`No menu items yet`}</h3>
					<p className="text-kumo-subtle mb-4">{t`Add links to build your navigation menu`}</p>
					<div className="flex justify-center gap-2">
						<Button
							icon={<FileIcon />}
							variant="outline"
							onClick={() => setIsContentPickerOpen(true)}
						>
							{t`Add Content`}
						</Button>
						<Button icon={<Plus />} onClick={() => setIsAddOpen(true)}>
							{t`Add Custom Link`}
						</Button>
					</div>
				</div>
			) : (
				<DndContext
					sensors={sensors}
					collisionDetection={closestCenter}
					onDragStart={handleDragStart}
					onDragMove={handleDragMove}
					onDragEnd={handleDragEnd}
					onDragCancel={handleDragCancel}
				>
					<SortableContext
						items={displayList.map((f) => f.item.id)}
						strategy={verticalListSortingStrategy}
					>
						<div className="space-y-2">
							{displayList.map((flatItem, idx) => (
								<SortableMenuItemRow
									key={flatItem.item.id}
									flatItem={flatItem}
									idx={idx}
									displayList={displayList}
									isFirstInGroup={isFirstInGroup(idx)}
									isLastInGroup={isLastInGroup(idx)}
									canIndent={canIndent(idx)}
									onMoveUp={() => moveItem(idx, "up")}
									onMoveDown={() => moveItem(idx, "down")}
									onIndent={() => indent(idx)}
									onOutdent={() => outdent(idx)}
									onEdit={() => setEditingItem(flatItem.item)}
									onDelete={() => deleteMutation.mutate(flatItem.item.id)}
								/>
							))}
						</div>
					</SortableContext>

					<DragOverlay>
						{activeItem ? (
							<DragPreview flatItem={activeItem} proposedDepth={proposedDepth} />
						) : null}
					</DragOverlay>
				</DndContext>
			)}

			{/* Edit dialog */}
			<Dialog.Root
				open={editingItem !== null}
				onOpenChange={(open: boolean) => {
					if (!open) {
						setEditingItem(null);
						setEditError(null);
					}
				}}
			>
				<Dialog className="p-6" size="lg">
					<div className="flex items-start justify-between gap-4 mb-4">
						<Dialog.Title className="text-lg font-semibold leading-none tracking-tight">
							{t`Edit Menu Item`}
						</Dialog.Title>
						<Dialog.Close
							aria-label={t`Close`}
							render={(props) => (
								<Button
									{...props}
									variant="ghost"
									shape="square"
									aria-label={t`Close`}
									className="absolute end-4 top-4"
								>
									<X className="h-4 w-4" />
									<span className="sr-only">{t`Close`}</span>
								</Button>
							)}
						/>
					</div>
					{editingItem && (
						<form onSubmit={handleUpdateItem} className="space-y-4">
							<Input label={t`Label`} name="label" required defaultValue={editingItem.label} />
							{editingItem.type === "custom" && (
								<Input
									label={t`URL`}
									name="url"
									type="text"
									required
									pattern="(https?://.+|/.*)"
									title={t`Enter a URL (https://…) or a relative path (/…)`}
									defaultValue={editingItem.custom_url || ""}
								/>
							)}
							<Select
								label={t`Target`}
								name="target"
								defaultValue={editingItem.target || ""}
								items={{ "": t`Same window`, _blank: t`New window` }}
							>
								<Select.Option value="">{t`Same window`}</Select.Option>
								<Select.Option value="_blank">{t`New window`}</Select.Option>
							</Select>
							<DialogError message={editError || getMutationError(updateMutation.error)} />
							<div className="flex justify-end gap-2">
								<Button type="button" variant="outline" onClick={() => setEditingItem(null)}>
									{t`Cancel`}
								</Button>
								<Button type="submit" disabled={updateMutation.isPending}>
									{updateMutation.isPending ? t`Saving...` : t`Save`}
								</Button>
							</div>
						</form>
					)}
				</Dialog>
			</Dialog.Root>
		</div>
	);
}
