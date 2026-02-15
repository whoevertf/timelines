import React from "react";

export type TimelineTask = {
    id: string;
    startDayKey: string; // "YYYY-MM-DD"
    lengthDays: number;  // e.g. 4 or 1-3 for fitted gaps
};

export type TimelineRow = {
    id: string;
    tasks: TimelineTask[];
};

type TimelineProps = {
    centerDate: Date;
    rangeDays?: number;
    onShift: (deltaDays: number) => void;
    onGoToday: () => void;

    rows: TimelineRow[];
    onCreateRow: () => void;
    onCreateTask: (rowId: string, startDate: Date) => void;
    onDeleteTask: (rowId: string, taskId: string) => void;
    onDeleteRow: (rowId: string) => void;
    onMoveTask: (
        fromRowId: string,
        taskId: string,
        toRowId: string,
        newStartDayKey: string
    ) => boolean;
    onResizeTask: (
        rowId: string,
        taskId: string,
        newStartDayKey: string,
        newLengthDays: number
    ) => boolean;
};

function startOfDay(d: Date) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}

function addDays(d: Date, days: number) {
    const x = new Date(d);
    x.setDate(x.getDate() + days);
    return x;
}

function isSameDay(a: Date, b: Date) {
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    );
}

// Use UTC day number to avoid DST edge cases
function toUtcDayNumber(d: Date) {
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}

function parseDayKey(key: string) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1);
}
function toIndexFromKey(key: string) {
    const [y, m, d] = key.split("-").map(Number);
    return Math.floor(Date.UTC(y, (m ?? 1) - 1, d ?? 1) / 86400000);
}

function keyFromIndex(idx: number) {
    const ms = idx * 86400000;
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

// function dayKey(d: Date) {
//     const y = d.getFullYear();
//     const m = String(d.getMonth() + 1).padStart(2, "0");
//     const day = String(d.getDate()).padStart(2, "0");
//     return `${y}-${m}-${day}`;
// }

export function Timeline({
    centerDate,
    rangeDays = 7,
    onShift,
    onGoToday,
    rows,
    onCreateRow,
    onCreateTask,
    onDeleteTask,
    onDeleteRow,
    onMoveTask,
    onResizeTask,
}: TimelineProps) {
    const total = rangeDays * 2 + 1;

    const today = startOfDay(new Date());
    const center = startOfDay(centerDate);

    const days = React.useMemo(
        () => Array.from({ length: total }, (_, i) => addDays(center, i - rangeDays)),
        [center.getTime(), rangeDays, total]
    );

    const visibleStart = days[0];
    const visibleStartUtc = toUtcDayNumber(visibleStart);

    const monthFmt = React.useMemo(
        () => new Intl.DateTimeFormat("ru-RU", { month: "short" }),
        []
    );

    // Trackpad wheel -> shift days (discrete)
    const wheelAccumRef = React.useRef(0);
    const handleWheel: React.WheelEventHandler<HTMLDivElement> = (e) => {
        e.preventDefault();

        const primary = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        const THRESHOLD = 80;

        wheelAccumRef.current += primary;

        while (wheelAccumRef.current >= THRESHOLD) {
            wheelAccumRef.current -= THRESHOLD;
            onShift(1);
        }
        while (wheelAccumRef.current <= -THRESHOLD) {
            wheelAccumRef.current += THRESHOLD;
            onShift(-1);
        }
    };
    const panRef = React.useRef<{
        active: boolean;
        pointerId: number;
        startX: number;
        lastX: number;
        accumPx: number;
    } | null>(null);
    const shiftByPixels = (dx: number) => {
        // dx > 0 значит палец вправо. Обычно “контент едет за пальцем”,
        // но для времени часто ожидается: свайп вправо -> идём в прошлое (влево по времени).
        // Если хочешь наоборот — поменяй знак в onShift ниже.
        const dayWidth = getDayWidth(); // у тебя уже есть getDayWidth() из drag
        const THRESHOLD = Math.max(28, dayWidth * 0.55); // хороший порог для iPad

        if (!panRef.current) return;

        panRef.current.accumPx += dx;

        while (panRef.current.accumPx >= THRESHOLD) {
            panRef.current.accumPx -= THRESHOLD;
            onShift(-1);
        }
        while (panRef.current.accumPx <= -THRESHOLD) {
            panRef.current.accumPx += THRESHOLD;
            onShift(1);
        }
    };
    const createHoldRef = React.useRef<null | {
        timer: number;
        pointerId: number;
        startX: number;
        startY: number;
        pointerType: string;
    }>(null);

    const HOLD_MS = (pointerType: string) =>
        pointerType === "pen" ? 320 : 260;
    const MOVE_TH = (pointerType: string) => (pointerType === "touch" || pointerType === "pen" ? 12 : 6);

    const clearCreateHold = () => {
        if (createHoldRef.current) {
            window.clearTimeout(createHoldRef.current.timer);
            createHoldRef.current = null;
        }
    };


    const isOnToday = isSameDay(center, today);

    // Long-press menu state: which task in which row, and where to show the popup
    const [menu, setMenu] = React.useState<null | { rowId: string; taskId: string; x: number; y: number }>(null);
    const pressTimerRef = React.useRef<number | null>(null);

    const closeMenu = React.useCallback(() => setMenu(null), []);

    React.useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") closeMenu();
        };
        const onDown = (e: MouseEvent) => {
            const target = e.target as HTMLElement | null;
            if (!target) return;
            if (target.closest(".taskMenu")) return;
            if (target.closest(".taskBlock")) return;
            closeMenu();
        };

        window.addEventListener("keydown", onKey);
        window.addEventListener("mousedown", onDown);
        return () => {
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("mousedown", onDown);
        };
    }, [closeMenu]);

    const startLongPress = (
        rowId: string,
        taskId: string,
        e: React.PointerEvent<HTMLDivElement>
    ) => {
        e.preventDefault();
        e.stopPropagation();

        if (pressTimerRef.current) window.clearTimeout(pressTimerRef.current);

        const el = e.currentTarget;
        pressTimerRef.current = window.setTimeout(() => {
            const rowEl = el.closest(".timelineTasksRow") as HTMLElement | null;
            if (!rowEl) return;

            const rowRect = rowEl.getBoundingClientRect();
            const rect = el.getBoundingClientRect();

            // menu to the right of task block
            const x = rect.right - rowRect.left + 10;
            const y = rect.top - rowRect.top;

            setMenu({ rowId, taskId, x, y });
        }, 450);
    };

    const cancelLongPress = () => {
        if (pressTimerRef.current) {
            window.clearTimeout(pressTimerRef.current);
            pressTimerRef.current = null;
        }
    };
    const stripRef = React.useRef<HTMLDivElement | null>(null);

    const [drag, setDrag] = React.useState<null | {
        taskId: string;
        fromRowId: string;
        fromStartIdx: number; // UTC day index of task start
        pointerId: number;
        startClientX: number;
        startClientY: number;
        dayWidth: number;
        previewRowId: string;
        previewStartIdx: number;
        moved: boolean;
        pointerType: string;
    }>(null);
    const [resize, setResize] = React.useState<null | {
        rowId: string;
        taskId: string;
        side: "left" | "right";
        pointerId: number;
        startClientX: number;
        dayWidth: number;
        pointerType: string;
        origStartIdx: number;
        origLen: number;

        previewStartIdx: number;
        previewLen: number;

        moved: boolean;
    }>(null);

    const stopResize = React.useCallback(() => {
        setResize(null);
    }, []);


    const stopDrag = React.useCallback(() => {
        setDrag(null);
    }, []);

    const getDayWidth = () => {
        const el = stripRef.current;
        if (!el) return 60;
        const rect = el.getBoundingClientRect();
        // ширина всей полосы / кол-во колонок
        return rect.width / total;
    };

    const getRowIdFromPoint = (x: number, y: number) => {
        const el = document.elementFromPoint(x, y) as HTMLElement | null;
        const row = el?.closest(".timelineTasksRow") as HTMLElement | null;
        return row?.dataset.rowid ?? null;
    };

    React.useEffect(() => {
        if (!drag) return;

        const onMove = (e: PointerEvent) => {
            if (e.pointerId !== drag.pointerId) return;

            const dx = e.clientX - drag.startClientX;
            const dy = e.clientY - drag.startClientY;

            const threshold = drag.pointerType === "touch" || drag.pointerType === "pen" ? 12 : 6;
            const moved = drag.moved || Math.abs(dx) > threshold || Math.abs(dy) > threshold;


            // при первом реальном движении — отключаем long-press меню
            if (moved) cancelLongPress();

            const deltaDays = Math.round(dx / drag.dayWidth);
            const rawStartIdx = drag.fromStartIdx + deltaDays;

            // определяем row под курсором (если не нашли — остаёмся в текущем previewRowId)
            const maybeRowId = getRowIdFromPoint(e.clientX, e.clientY);
            const targetRowId = maybeRowId ?? drag.previewRowId;

            setDrag((prev) => {
                if (!prev) return prev;
                return {
                    ...prev,
                    moved,
                    previewRowId: targetRowId,
                    previewStartIdx: rawStartIdx,
                };
            });
        };

        const onUp = (e: PointerEvent) => {
            if (e.pointerId !== drag.pointerId) return;

            // если не двигали — это был long-press/click сценарий (ничего не делаем здесь)
            if (!drag.moved) {
                stopDrag();
                return;
            }

            const ok = onMoveTask(
                drag.fromRowId,
                drag.taskId,
                drag.previewRowId,
                keyFromIndex(drag.previewStartIdx)
            );

            // если не получилось (конфликт) — просто откатываем
            stopDrag();
            if (!ok) closeMenu();
        };

        const onCancel = (e: PointerEvent) => {
            if (e.pointerId !== drag.pointerId) return;
            stopDrag();
        };

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onCancel);

        return () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onCancel);
        };
    }, [drag, total, cancelLongPress, onMoveTask, stopDrag, closeMenu]);
    React.useEffect(() => {
        if (!resize) return;

        const onMove = (e: PointerEvent) => {
            if (e.pointerId !== resize.pointerId) return;

            const dx = e.clientX - resize.startClientX;
            const threshold = resize.pointerType === "touch" || resize.pointerType === "pen" ? 12 : 6;
            const moved = resize.moved || Math.abs(dx) > threshold;


            if (moved) cancelLongPress();

            const deltaDays = Math.round(dx / resize.dayWidth);

            let newStartIdx = resize.origStartIdx;
            let newLen = resize.origLen;

            if (resize.side === "right") {
                newLen = Math.max(1, resize.origLen + deltaDays);
            } else {
                // тянем левую границу: старт двигается, длина компенсируется
                newStartIdx = resize.origStartIdx + deltaDays;
                newLen = resize.origLen - deltaDays;
                if (newLen < 1) {
                    // не даём уйти в 0: фиксируем минимум 1 день
                    newLen = 1;
                    newStartIdx = resize.origStartIdx + (resize.origLen - 1);
                }
            }

            setResize((prev) => {
                if (!prev) return prev;
                return {
                    ...prev,
                    moved,
                    previewStartIdx: newStartIdx,
                    previewLen: newLen,
                };
            });
        };

        const onUp = (e: PointerEvent) => {
            if (e.pointerId !== resize.pointerId) return;

            // если не двигали — это был “тап” у края, не делаем resize
            if (!resize.moved) {
                stopResize();
                return;
            }

            const ok = onResizeTask(
                resize.rowId,
                resize.taskId,
                keyFromIndex(resize.previewStartIdx),
                resize.previewLen
            );

            stopResize();
            if (!ok) closeMenu();
        };

        const onCancel = (e: PointerEvent) => {
            if (e.pointerId !== resize.pointerId) return;
            stopResize();
        };

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onCancel);

        return () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onCancel);
        };
    }, [resize, cancelLongPress, onResizeTask, stopResize, closeMenu]);

    // Helpers per-row: compute occupied cells and visible blocks for a given row
    const computeOccupied = React.useCallback(
        (row: TimelineRow) => {
            const occ = Array<boolean>(total).fill(false);
            for (const t of row.tasks) {
                const start = startOfDay(parseDayKey(t.startDayKey));
                const startIdx = toUtcDayNumber(start) - visibleStartUtc;
                const endIdx = startIdx + t.lengthDays;

                const from = Math.max(0, startIdx);
                const to = Math.min(total, endIdx);

                for (let i = from; i < to; i++) occ[i] = true;
            }
            return occ;
        },
        [total, visibleStartUtc]
    );

    const computeVisibleBlocks = React.useCallback(
        (row: TimelineRow) => {
            return row.tasks
                .map((t) => {
                    const start = startOfDay(parseDayKey(t.startDayKey));
                    const startIdx = toUtcDayNumber(start) - visibleStartUtc;
                    const endIdx = startIdx + t.lengthDays;

                    const clampedStart = Math.max(0, startIdx);
                    const clampedEnd = Math.min(total, endIdx);

                    if (clampedEnd <= 0 || clampedStart >= total) return null;

                    return {
                        id: t.id,
                        gridColumnStart: clampedStart + 1, // CSS grid 1-based
                        span: clampedEnd - clampedStart,
                    };
                })
                .filter(Boolean) as Array<{ id: string; gridColumnStart: number; span: number }>;
        },
        [total, visibleStartUtc]
    );

    return (
        <div className="timeline" aria-label="Timeline">
            <div className="timelineHeader">
                <span className="timelineHint">Свайпай по тачпаду влево/вправо</span>

                <button
                    type="button"
                    className="todayBtn"
                    onClick={onGoToday}
                    disabled={isOnToday}
                    aria-disabled={isOnToday}
                    title={isOnToday ? "Уже на текущем дне" : "Вернуться к текущему дню"}
                >
                    Сегодня
                </button>
            </div>

            {/* CSS var to control columns count */}
            <div
                className="timelineStrip"
                ref={stripRef}
                onWheel={handleWheel}
                style={{ ["--cols" as any]: total }}
                onPointerDown={(e) => {
                    // включаем pan ТОЛЬКО для touch/pen, чтобы не мешать мыши/drag задач
                    if (e.pointerType !== "touch" && e.pointerType !== "pen") return;

                    // важно: чтобы браузер не делал скролл страницы
                    e.preventDefault();

                    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
                    panRef.current = {
                        active: true,
                        pointerId: e.pointerId,
                        startX: e.clientX,
                        lastX: e.clientX,
                        accumPx: 0,
                    };
                }}
                onPointerMove={(e) => {
                    const s = panRef.current;
                    if (!s || !s.active || e.pointerId !== s.pointerId) return;

                    // предотвращаем скролл/резину iOS
                    e.preventDefault();

                    const dx = e.clientX - s.lastX;
                    s.lastX = e.clientX;

                    // throttle через rAF, чтобы не дергать state слишком часто (iPad заметно выигрывает)
                    // простой вариант: аккумулируем и сдвигаем дискретно
                    shiftByPixels(dx);
                }}
                onPointerUp={(e) => {
                    const s = panRef.current;
                    if (!s || e.pointerId !== s.pointerId) return;
                    panRef.current = null;
                }}
                onPointerCancel={(e) => {
                    const s = panRef.current;
                    if (!s || e.pointerId !== s.pointerId) return;
                    panRef.current = null;
                }}
            >
                {/* Dates row */}
                <div className="datesSection">
                    <div className="datesGutter" aria-hidden="true" />
                    <div className="timelineCells timelineDates">
                        {days.map((d) => {
                            const isCenter = isSameDay(d, center);
                            const isToday = isSameDay(d, today);
                            const month = monthFmt.format(d).replace(".", "").toUpperCase();

                            return (
                                <div
                                    key={d.toISOString()}
                                    className={[
                                        "timelineCell",
                                        isCenter ? "isCenter" : "",
                                        isToday ? "isToday" : "",
                                    ].join(" ")}
                                >
                                    <div className="cellMonth">{month}</div>
                                    <div className="cellDay">{String(d.getDate()).padStart(2, "0")}</div>
                                </div>
                            );
                        })}
                    </div>
                </div>
                {/* Tasks section: left gutter + rows */}
                <div className="tasksSection">
                    <div className="tasksGutter" aria-hidden="true">
                        {rows.map((r, idx) => (
                            <div key={r.id} className="rowGutterCell">
                                {idx === 0 ? (
                                    <button
                                        type="button"
                                        className="addRowBtn"
                                        onClick={onCreateRow}
                                        title="Добавить ряд"
                                    >
                                        +
                                    </button>
                                ) : (
                                    <div className="rowGutterSpacer" />
                                )}

                                <button
                                    type="button"
                                    className="deleteRowBtn"
                                    onClick={() => onDeleteRow(r.id)}
                                    title="Удалить ряд"
                                >
                                    –
                                </button>
                            </div>
                        ))}
                    </div>


                    <div className="tasksRows">
                        {rows.map((row) => {
                            const occupied = computeOccupied(row);
                            const blocks = computeVisibleBlocks(row);

                            return (
                                <div
                                    key={row.id}
                                    className="timelineTasksRow"
                                    aria-label="Tasks row"
                                    data-rowid={row.id}
                                >
                                    <div className="timelineCells timelineTasksBg">
                                        {days.map((d, idx) => (
                                            <button
                                                key={d.toISOString()}
                                                type="button"
                                                className={["timelineTaskCell", occupied[idx] ? "isOccupied" : ""].join(" ")}
                                                disabled={occupied[idx]}
                                                aria-disabled={occupied[idx]}
                                                aria-label={
                                                    occupied[idx]
                                                        ? `День занят задачей: ${d.toLocaleDateString("ru-RU")}`
                                                        : `Создать задачу: ${d.toLocaleDateString("ru-RU")}`
                                                }

                                                // ⬇️ NEW: long-press create
                                                onPointerDown={(e) => {
                                                    if (occupied[idx]) return;

                                                    // iPad/Safari: чтобы не было выделения/скролла
                                                    if (e.pointerType === "touch") e.preventDefault();

                                                    clearCreateHold();

                                                    const timer = window.setTimeout(() => {
                                                        // запуск создания по твоим старым правилам (в App.tsx)
                                                        onCreateTask(row.id, startOfDay(d));
                                                        clearCreateHold();
                                                    }, HOLD_MS(e.pointerType));

                                                    createHoldRef.current = {
                                                        timer,
                                                        pointerId: e.pointerId,
                                                        startX: e.clientX,
                                                        startY: e.clientY,
                                                        pointerType: e.pointerType,
                                                    };
                                                }}

                                                onPointerMove={(e) => {
                                                    const h = createHoldRef.current;
                                                    if (!h) return;
                                                    if (e.pointerId !== h.pointerId) return;

                                                    const dx = e.clientX - h.startX;
                                                    const dy = e.clientY - h.startY;

                                                    // Pencil: НЕ отменяем long-press из-за микродвижений
                                                    if (h.pointerType !== "pen") {
                                                        if (
                                                            Math.abs(dx) > MOVE_TH(h.pointerType) ||
                                                            Math.abs(dy) > MOVE_TH(h.pointerType)
                                                        ) {
                                                            clearCreateHold();
                                                        }
                                                    }

                                                }}

                                                onPointerUp={() => clearCreateHold()}
                                                onPointerCancel={() => clearCreateHold()}
                                                onPointerLeave={() => clearCreateHold()}
                                            />
                                        ))}
                                    </div>

                                    <div className="timelineTasksBlocks" aria-hidden="true">
                                        {blocks.map((b) => {
                                            const isDraggingThis =
                                                drag && drag.taskId === b.id && drag.fromRowId === row.id;

                                            return (
                                                <div
                                                    key={b.id}
                                                    className={["taskBlock", isDraggingThis ? "isDragging" : ""].join(" ")}
                                                    style={{ gridColumn: `${b.gridColumnStart} / span ${b.span}` }}
                                                    onPointerDown={(e) => {
                                                        // long-press меню по прежнему доступен, если пользователь не двигает
                                                        startLongPress(row.id, b.id, e);

                                                        const t = row.tasks.find((x) => x.id === b.id);
                                                        if (!t) return;

                                                        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                                                        const x = e.clientX - rect.left;

                                                        const EDGE = 10; // px — “невидимая ручка”

                                                        const isLeftEdge = x <= EDGE;
                                                        const isRightEdge = x >= rect.width - EDGE;

                                                        const startIdx = toIndexFromKey(t.startDayKey);
                                                        const dayWidth = getDayWidth();

                                                        // Если попали в край — начинаем resize, а не drag
                                                        if (isLeftEdge || isRightEdge) {
                                                            setResize({
                                                                rowId: row.id,
                                                                taskId: b.id,
                                                                side: isLeftEdge ? "left" : "right",
                                                                pointerId: e.pointerId,
                                                                startClientX: e.clientX,
                                                                dayWidth,
                                                                origStartIdx: startIdx,
                                                                origLen: t.lengthDays,
                                                                previewStartIdx: startIdx,
                                                                previewLen: t.lengthDays,
                                                                moved: false,
                                                                pointerType: e.pointerType,
                                                            });
                                                            return;
                                                        }

                                                        // Иначе — обычный drag
                                                        setDrag({
                                                            taskId: b.id,
                                                            fromRowId: row.id,
                                                            fromStartIdx: startIdx,
                                                            pointerId: e.pointerId,
                                                            startClientX: e.clientX,
                                                            startClientY: e.clientY,
                                                            dayWidth,
                                                            previewRowId: row.id,
                                                            previewStartIdx: startIdx,
                                                            moved: false,
                                                            pointerType: e.pointerType,
                                                        });
                                                    }}
                                                    onPointerUp={() => {
                                                        cancelLongPress();
                                                        // pointerup обрабатывается глобально при drag, но если drag не начался — ок
                                                    }}
                                                    onPointerCancel={() => {
                                                        cancelLongPress();
                                                        stopDrag();
                                                    }}
                                                    onPointerLeave={() => {
                                                        // leave не отменяем drag — пользователь может тащить
                                                        cancelLongPress();
                                                    }}
                                                />
                                            );
                                        })}
                                    </div>
                                    {resize && resize.moved && resize.rowId === row.id && (() => {
                                        const task = rows
                                            .find((r) => r.id === resize.rowId)
                                            ?.tasks.find((t) => t.id === resize.taskId);
                                        if (!task) return null;

                                        const startIdx = resize.previewStartIdx;
                                        const startOffset = startIdx - visibleStartUtc;

                                        const rawStart = startOffset;
                                        const rawEnd = startOffset + resize.previewLen;

                                        const clampedStart = Math.max(0, rawStart);
                                        const clampedEnd = Math.min(total, rawEnd);

                                        if (clampedEnd <= 0 || clampedStart >= total) return null;

                                        const gridColumnStart = clampedStart + 1;
                                        const span = clampedEnd - clampedStart;

                                        return (
                                            <div className="timelineTasksBlocks dragPreviewLayer" aria-hidden="true">
                                                <div
                                                    className="taskBlock dragPreview"
                                                    style={{ gridColumn: `${gridColumnStart} / span ${span}` }}
                                                />
                                            </div>
                                        );
                                    })()}
                                    {drag && drag.moved && drag.previewRowId === row.id && (() => {
                                        // найдём длину таска
                                        const task = rows
                                            .find((r) => r.id === drag.fromRowId)
                                            ?.tasks.find((t) => t.id === drag.taskId);

                                        if (!task) return null;

                                        // позиция относительно видимого окна
                                        const startIdx = drag.previewStartIdx;
                                        const startOffset = startIdx - visibleStartUtc;

                                        const rawStart = startOffset;
                                        const rawEnd = startOffset + task.lengthDays;

                                        const clampedStart = Math.max(0, rawStart);
                                        const clampedEnd = Math.min(total, rawEnd);

                                        if (clampedEnd <= 0 || clampedStart >= total) return null;

                                        const gridColumnStart = clampedStart + 1;
                                        const span = clampedEnd - clampedStart;

                                        return (
                                            <div className="timelineTasksBlocks dragPreviewLayer" aria-hidden="true">
                                                <div
                                                    className="taskBlock dragPreview"
                                                    style={{ gridColumn: `${gridColumnStart} / span ${span}` }}
                                                />
                                            </div>
                                        );
                                    })()}



                                    {menu && menu.rowId === row.id && (
                                        <div className="taskMenu" style={{ left: menu.x, top: menu.y }} role="menu">
                                            <button
                                                type="button"
                                                className="taskMenuBtn danger"
                                                onClick={() => {
                                                    onDeleteTask(menu.rowId, menu.taskId);
                                                    closeMenu();
                                                }}
                                            >
                                                Удалить задачу
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
