import { afterEach, expect, mock, test } from "bun:test";
import { VideoRecorder } from "../js/utils/video/video_note_recorder.js";

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalMediaRecorder = Object.getOwnPropertyDescriptor(globalThis, "MediaRecorder");
afterEach(() => {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
    if (originalMediaRecorder) Object.defineProperty(globalThis, "MediaRecorder", originalMediaRecorder);
    else Reflect.deleteProperty(globalThis, "MediaRecorder");
});

function setup() {
    let native!: FakeMediaRecorder;
    class FakeMediaRecorder {
        onstart: (() => void) | null = null;
        onerror: (() => void) | null = null;
        start = mock(() => {});
        constructor() { native = this; }
    }
    Object.defineProperty(globalThis, "MediaRecorder", { configurable: true, value: FakeMediaRecorder });
    const stream = { active: true, getAudioTracks: () => [] };
    Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: { mediaDevices: { getUserMedia: async () => stream } }
    });
    const recorder = Object.assign(Object.create(VideoRecorder.prototype), {
        isRecording: false,
        videoSource: { play: async () => {}, style: {} },
        canvas: { captureStream: () => stream },
        _startRenderLoop: mock(() => {}),
        _setupPreview: mock(() => {}),
        _startTimer: mock(() => {}),
        _cleanup: mock(() => {})
    }) as VideoRecorder;
    return { recorder, getNative: () => native };
}

test("запуск видеокружка завершается только после onstart", async () => {
    const { recorder, getNative } = setup();
    let ready = false;
    const started = recorder.start({ replaceChildren: () => {} } as unknown as HTMLElement).then(() => { ready = true; });
    // getUserMedia и play завершились, нативный start только поставил событие в очередь.
    await Promise.resolve();
    await Promise.resolve();
    expect(getNative().start).toHaveBeenCalledWith(100);
    expect(ready).toBe(false);
    expect(recorder.isRecording).toBe(false);
    getNative().onstart!();
    await started;
    expect(ready).toBe(true);
    expect(recorder.isRecording).toBe(true);
    expect(recorder._startTimer).toHaveBeenCalledTimes(1);
});

test("ошибка запуска рекордера отклоняет запуск и освобождает ресурсы", async () => {
    const { recorder, getNative } = setup();
    const started = recorder.start({ replaceChildren: () => {} } as unknown as HTMLElement);
    await Promise.resolve();
    await Promise.resolve();
    getNative().onerror!();
    await expect(started).rejects.toThrow("MediaRecorder start failed");
    expect(recorder._cleanup).toHaveBeenCalledTimes(1);
});


test("источник камеры добавлен в DOM до ожидания воспроизведения", async () => {
    const { recorder, getNative } = setup();
    let resolvePlay!: () => void;
    recorder.videoSource.play = () => new Promise<void>(resolve => { resolvePlay = resolve; });
    const replaceChildren = mock(() => {});
    const starting = recorder.start({ replaceChildren } as unknown as HTMLElement);
    await Promise.resolve();
    expect(replaceChildren).toHaveBeenCalledWith(recorder.videoSource);
    resolvePlay();
    await Promise.resolve();
    getNative().onstart!();
    await starting;
    expect(recorder.isRecording).toBe(true);
});
