import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createNoteRecordingGesture } from "../js/utils/media/note_recording_gesture.js";

const originalDocument = globalThis.document;
beforeEach(() => {
    globalThis.document = new EventTarget() as unknown as Document;
});
afterEach(() => {
    globalThis.document = originalDocument;
});

function setup(start: () => Promise<boolean | void> = async () => true) {
    const element = Object.assign(new EventTarget(), { dataset: { recordingMode: "voice" } }) as unknown as HTMLElement;
    const session = { start: mock(start), lock: mock(() => {}), stop: mock(async () => {}), cancel: mock(async () => {}) };
    const getSession = mock(() => session);
    const update = mock(() => {});
    const controller = createNoteRecordingGesture(element, {
        getSession, update, isBusy: () => false, cancelActive: async () => {}
    });
    return { element, session, getSession, update, controller, tap: controller.opts.tap! };
}

const event = new Event("test", { cancelable: true });

describe("Общая кнопка записи", () => {
    test("короткое нажатие переключает режим без запуска записи", () => {
        const { element, tap, session, controller, update } = setup();
        tap.onTap!(event);
        expect(element.dataset.recordingMode).toBe("video");
        tap.onTap!(event);
        expect(element.dataset.recordingMode).toBe("voice");
        expect(update).toHaveBeenCalledTimes(2);
        expect(session.start).not.toHaveBeenCalled();
        controller.destroy();
    });

    test.each(["voice", "video"])("удержание записывает выбранный режим %s, отпускание отправляет", async mode => {
        const { element, tap, session, controller, getSession } = setup();
        element.dataset.recordingMode = mode;
        tap.onLongTap!(event);
        expect(getSession).toHaveBeenCalledWith(mode === "video");
        expect(session.start).toHaveBeenCalledWith({ hold: true });
        await tap.onLongTapEnd!(event);
        expect(session.stop).toHaveBeenCalledTimes(1);
        expect(session.cancel).not.toHaveBeenCalled();
        controller.destroy();
    });

    test("отпускание во время запроса разрешений дожидается запуска", async () => {
        let resolve!: () => void;
        const { tap, session, controller } = setup(() => new Promise<void>(done => { resolve = done; }));
        tap.onLongTap!(event);
        const finished = tap.onLongTapEnd!(event);
        expect(session.stop).not.toHaveBeenCalled();
        resolve();
        await finished;
        expect(session.stop).toHaveBeenCalledTimes(1);
        controller.destroy();
    });

    test("свайп влево отменяет запись без отправки", async () => {
        const { tap, session, controller } = setup();
        tap.onLongTap!(event);
        controller.opts.swipe!.onCommit!("left");
        await tap.onLongTapEnd!(event);
        expect(session.cancel).toHaveBeenCalledTimes(1);
        expect(session.stop).not.toHaveBeenCalled();
        controller.destroy();
    });

    test.each(["voice", "video"])("свайп вверх закрепляет %s и не отправляет при отпускании", async mode => {
        const { element, tap, session, controller } = setup();
        element.dataset.recordingMode = mode;
        tap.onLongTap!(event);
        controller.opts.swipe!.onCommit!("up");
        await tap.onLongTapEnd!(event);
        expect(session.lock).toHaveBeenCalled();
        expect(session.stop).not.toHaveBeenCalled();
        expect(session.cancel).not.toHaveBeenCalled();
        controller.destroy();
    });

    test("закрепление до получения разрешений раскрывает панель после запуска", async () => {
        let resolve!: () => void;
        const { tap, session, controller } = setup(() => new Promise<void>(done => { resolve = done; }));
        tap.onLongTap!(event);
        controller.opts.swipe!.onCommit!("up");
        const finished = tap.onLongTapEnd!(event);
        expect(session.lock).not.toHaveBeenCalled();
        resolve();
        await finished;
        expect(session.lock).toHaveBeenCalled();
        expect(session.stop).not.toHaveBeenCalled();
        controller.destroy();
    });

    test("прерывание жеста во время запуска отменяет запись после разрешения", async () => {
        let resolve!: () => void;
        const { tap, session, controller } = setup(() => new Promise<void>(done => { resolve = done; }));
        tap.onLongTap!(event);
        const finished = controller.opts.onCancel!(event);
        resolve();
        await finished;
        expect(session.cancel).toHaveBeenCalledTimes(1);
        expect(session.stop).not.toHaveBeenCalled();
        controller.destroy();
    });
});
