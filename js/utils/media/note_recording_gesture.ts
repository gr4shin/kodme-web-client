import { GestureController } from "../gesture_controller.js";
import { Logger } from "../logs/logger.js";

/** Минимальный интерфейс сессии записи голоса или видеокружка. */
export interface NoteRecordingSession {
    start(options?: { hold?: boolean }): Promise<boolean | void>;
    lock?(): void;
    stop(): Promise<void>;
    cancel(): void | Promise<void>;
}

/** Общая кнопка: тап переключает режим, удержание записывает до отпускания. */
export function createNoteRecordingGesture(
    element: HTMLElement,
    options: {
        getSession: (video: boolean) => NoteRecordingSession | null;
        isBusy: () => boolean;
        cancelActive: () => void | Promise<void>;
        update: () => void;
    }
): GestureController {
    let session: NoteRecordingSession | null = null;
    let starting: Promise<boolean | void> | null = null;
    let cancelled = false;
    let locked = false;
    let finishing = false;

    const execute = async (action: () => Promise<void>): Promise<void> => {
        try { await action(); } catch (error) { Logger.error(error); }
    };

    const finish = async (cancel: boolean): Promise<void> => {
        cancelled ||= cancel;
        if (!session || finishing) return;
        finishing = true;
        const current = session;
        try {
            await starting;
            if (cancelled) await current.cancel();
            else if (locked) current.lock?.();
            else await current.stop();
        } finally {
            session = null;
            starting = null;
            finishing = false;
            cancelled = false;
            locked = false;
        }
    };

    const tap = (): void => {
        if (session || finishing) return;
        if (options.isBusy()) {
            void execute(async () => { await options.cancelActive(); });
            return;
        }
        element.dataset.recordingMode = element.dataset.recordingMode === "video" ? "voice" : "video";
        options.update();
    };

    // Нативная клавиатурная активация кнопки переключает режим.
    element.addEventListener("click", event => {
        if (event.detail === 0) tap();
    });

    return new GestureController(element, {
        ignoreInteractive: false,
        stopPropagation: true,
        threshold: 8,
        tap: {
            timeout: 300,
            longTapTimeout: 250,
            onTap: event => {
                if (event.cancelable) event.preventDefault();
                tap();
            },
            onLongTap: event => {
                if (event.cancelable) event.preventDefault();
                if (session || finishing || options.isBusy()) return;
                session = options.getSession(element.dataset.recordingMode === "video");
                if (!session) return;
                cancelled = false;
                locked = false;
                starting = session.start({ hold: true }).catch(error => {
                    cancelled = true;
                    Logger.error(error);
                    return false;
                });
            },
            onLongTapEnd: () => execute(() => finish(false))
        },
        swipe: {
            directions: ["up", "left"],
            commitDistance: 80,
            commitVelocity: Infinity,
            onCommit: direction => {
                if (!session || finishing) return;
                if (direction === "left") {
                    cancelled = true;
                } else if (direction === "up" && !cancelled) {
                    locked = true;
                    const current = session;
                    void execute(async () => {
                        await starting;
                        if (locked && !cancelled && session === current) current.lock?.();
                    });
                }
            }
        },
        onCancel: () => execute(() => finish(true)),
        onContextMenu: event => event.preventDefault()
    });
}
