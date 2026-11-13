// Импортируем utils
import { Logger } from "../../utils/logs/logger.js";
import { getErrorName } from "../helpers/error_util.js";

/**
 * ***************************************************************************
 * @class VideoRecorder
 * @description Менеджер записи видео-кружочков через Canvas.
 * Реализует бесшовное переключение камер (front/back) во время записи без прерывания 
 * основного видеопотока, что гарантирует целостность финального WebM файла.
 * ***************************************************************************
 */
export class VideoRecorder {

    // Конструктор

    /** Основной экземпляр рекордера. */
    recorder: MediaRecorder | null;

    /** Стабильный поток с Canvas (Video + Audio). */
    stream: MediaStream | null;

    /** Массив накопленных данных видео. */
    chunks: Blob[];

    // Состояния
    /** Идёт ли запись. */
    isRecording: boolean;

    /** На паузе ли запись. */
    isPaused: boolean;

    /** Активная камера: "user" или "environment". */
    currentFacingMode: "user" | "environment";

    // Хронометраж
    /** Время начала записи. */
    startTime: number;

    /** Время начала паузы. */
    pauseStartedAt: number;

    /** Суммарная длительность пауз. */
    pausedDuration: number;

    /** Сколько реально записано (без пауз), мс. */
    elapsedMs: number;

    /** Интервал обновления времени (null — таймер не запущен). */
    timerInterval: ReturnType<typeof setInterval> | null;

    // Canvas-ресурсы для "бесшовного" моста
    /** Скрытый Canvas-мостик 480×480. */
    canvas: HTMLCanvasElement;

    /** Контекст отрисовки Canvas (2D без альфы). */
    ctx: CanvasRenderingContext2D | null;

    /** Скрытый элемент-источник текущей камеры. */
    videoSource: HTMLVideoElement;

    /** Идентификатор текущего кадра анимации (null — цикл не запущен). */
    animationFrame: ReturnType<typeof requestAnimationFrame> | null;

    /** Видимый элемент предпросмотра. */
    previewElement: HTMLVideoElement | null;

    /** Callback для обновления таймера в UI — отформатированное время MM:SS. */
    onTimeUpdate: ((formattedTime: string) => void) | null;

    constructor() {

        this.recorder = null;
        this.stream = null;
        this.chunks = [];

        // Состояния
        this.isRecording = false;
        this.isPaused = false;
        this.currentFacingMode = "user"; // 'user' или 'environment'

        // Хронометраж
        this.startTime = 0;
        this.pauseStartedAt = 0;
        this.pausedDuration = 0;
        this.elapsedMs = 0;
        this.timerInterval = null;

        // Canvas-ресурсы для "бесшовного" моста
        this.canvas = document.createElement("canvas");
        this.canvas.width = 480;
        this.canvas.height = 480;
        this.ctx = this.canvas.getContext("2d", { alpha: false });

        this.videoSource = document.createElement("video");
        this.animationFrame = null;

        this.previewElement = null;

        this.onTimeUpdate = null;

        Logger.debug("[VideoRecorder] Instance created (Canvas Engine)");
    }

    /**
     * ***************************************************************************
     * Запуск записи
     * @param {HTMLElement} previewContainer - Контейнер для вставки видео-превью
     * @returns {Promise<void>}
     * ***************************************************************************
     */
    async start(previewContainer: HTMLElement): Promise<void> {
        if (this.isRecording) return;

        try {
            Logger.debug("[VideoRecorder] Starting recording session...");

            // Захватываем начальные медиа-устройства
            const deviceStream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true },
                video: { width: 480, height: 480, facingMode: this.currentFacingMode }
            });

            // Настраиваем донорский видео-поток для отрисовки на Canvas
            this.videoSource.muted = true;
            this.videoSource.playsInline = true;
            this.videoSource.srcObject = deviceStream;

            // Держим источник камеры в DOM во время play(): браузеры могут
            // откладывать воспроизведение отсоединённого видео. До готовности
            // canvas-превью пользователь уже видит живую камеру.
            Object.assign(this.videoSource.style, {
                width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%",
                position: "static", opacity: "1", pointerEvents: "auto"
            });
            previewContainer.replaceChildren(this.videoSource);

            // Ждем воспроизведения, но ловим ошибку прерывания
            try {
                await this.videoSource.play();
            } catch (e) {
                if (getErrorName(e) === "AbortError") {
                    Logger.debug("[VideoRecorder] Play interrupted (normal if stopped fast)");
                    return; // Просто выходим, cleanup сделает остальное
                }
                throw e;
            }

            if (!deviceStream.active) return;

            // Запускаем бесконечный цикл отрисовки Камера -> Canvas
            this._startRenderLoop();

            // Создаем стабильный Stream из Canvas (30 FPS)
            const canvasStream = this.canvas.captureStream(30);

            // Прокидываем аудио-трек из реального устройства в поток канваса
            const audioTrack = deviceStream.getAudioTracks()[0];
            if (audioTrack) canvasStream.addTrack(audioTrack);

            this.stream = canvasStream;
            this._setupPreview(previewContainer);

            // Инициализируем единственный MediaRecorder на всю сессию
            this.recorder = new MediaRecorder(this.stream, {
                mimeType: "video/webm;codecs=vp8,opus"
            });

            // Прослушивание
            this.recorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    this.chunks.push(e.data);
                }
            };

            // start() ставит событие onstart в очередь. Ждём его, чтобы
            // сессия показывала превью уже с активным состоянием записи.
            const recorder = this.recorder;
            await new Promise<void>((resolve, reject) => {
                recorder.onstart = () => {
                    this.isRecording = true;
                    this.startTime = Date.now();
                    this._startTimer();
                    Logger.debug("[VideoRecorder] MediaRecorder started");
                    resolve();
                };
                recorder.onerror = () => reject(new Error("[VideoRecorder] MediaRecorder start failed"));
                recorder.start(100);
            });

        } catch (error) {
            Logger.error("[VideoRecorder] Start error:", error);
            this._cleanup();
            throw error;
        }

    }

    /**
     * ***************************************************************************
     * Бесшовное переключение между фронтальной и основной камерой
     * @returns {Promise<void>}
     * ***************************************************************************
     */
    async toggleCamera(): Promise<void> {
        if (!this.isRecording) return;

        // Локальный захват: суждение this.ctx не переносится в замыкания ниже
        const ctx = this.ctx;
        if (!ctx) return;

        Logger.debug("[VideoRecorder] Toggling camera...");
        ctx.filter = 'blur(10px)';

        // Вычисляем целевой режим, но НЕ перезаписываем this.currentFacingMode сразу
        const targetFacingMode = this.currentFacingMode === "user" ? "environment" : "user";

        try {

            const oldStream = this.videoSource.srcObject;

            // 1. Останавливаем старые треки и отвязываем источник.
            // srcObject в DOM типизирован как MediaProvider, но мы всегда
            // кладём сюда MediaStream — сужаем через instanceof (invariant).
            if (oldStream instanceof MediaStream) {
                oldStream.getVideoTracks().forEach(t => t.stop());
                this.videoSource.srcObject = null;
            }

            // 2. Даем Android Camera HAL время (~250мс) полностью освободить сенсор
            await new Promise(resolve => setTimeout(resolve, 250));

            // 3. Запрашиваем новый поток (ideal вместо точного совпадения дает fallback)
            const newDeviceStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 480 },
                    height: { ideal: 480 },
                    facingMode: { ideal: targetFacingMode }
                }
            });

            // 4. Обновляем стейт ТОЛЬКО после успеха
            this.currentFacingMode = targetFacingMode;

            // Подключаем к Canvas
            this.videoSource.srcObject = newDeviceStream;

            await new Promise((resolve) => {
                this.videoSource.onloadedmetadata = () => {
                    this.videoSource.play().then(resolve);
                };
            });

            ctx.filter = 'none';
            Logger.debug("[VideoRecorder] Camera switched to:", this.currentFacingMode);

        } catch (error) {
            ctx.filter = 'none';
            Logger.error("[VideoRecorder] Toggle error:", error);
        }
        
    }

    /**
     * ***************************************************************************
     * Остановка записи и формирование итогового файла
     * @returns {Promise<File|null>}
     * ***************************************************************************
     */
    stop(): Promise<File | null> {

        // Возвращаем промис
        return new Promise<File | null>((resolve) => {
            if (!this.recorder) return resolve(null);

            const handleStop = () => {

                // Собираем блоб
                const blob = new Blob(this.chunks, { type: "video/webm" });

                // Формируем File для корректной работы с API
                const file = new File([blob], `video_note_${Date.now()}.webm`, {
                    type: "video/webm",
                    lastModified: Date.now()
                });

                Logger.debug("[VideoRecorder] Final file created:", file.name, file.size);

                // Отправляем файл
                resolve(file);
                this._cleanup();

            };

            // Проверяем статус
            if (this.recorder.state === "inactive") {
                handleStop();
            } else {
                this.recorder.onstop = handleStop;
                this.recorder.stop();
            }

        });

    }

    /**
     * ***************************************************************************
     * Приостановка записи
     * ***************************************************************************
     */
    pause(): void {
        if (this.recorder && this.recorder.state === "recording") {
            this.recorder.pause();
            this.isPaused = true;
            this.pauseStartedAt = Date.now();
            Logger.debug("[VideoRecorder] Paused");
        }
    }

    /**
     * ***************************************************************************
     * Продолжение записи
     * ***************************************************************************
     */
    resume(): void {
        if (this.recorder && this.recorder.state === "paused") {
            this.recorder.resume();
            this.isPaused = false;
            this.pausedDuration += Date.now() - this.pauseStartedAt;
            Logger.debug("[VideoRecorder] Resumed");
        }
    }

    /**
     * ***************************************************************************
     * Внутренний цикл отрисовки кадров видео на Canvas
     * @private
     * ***************************************************************************
     */
    _startRenderLoop(): void {

        // Локальный захват: суждение this.ctx не переносится в замыкание draw
        const ctx = this.ctx;
        if (!ctx) return;

        const draw = () => {
            if (this.videoSource.readyState === this.videoSource.HAVE_ENOUGH_DATA) {
                ctx.drawImage(this.videoSource, 0, 0, 480, 480);
            }
            this.animationFrame = requestAnimationFrame(draw);
        };
        this.animationFrame = requestAnimationFrame(draw);
    }

    /**
     * ***************************************************************************
     * Настройка визуального превью для пользователя
     * @param {HTMLElement} container - DOM контейнер
     * @private
     * ***************************************************************************
     */
    _setupPreview(container: HTMLElement): void {
        if (!container) return;
        if (this.previewElement) this.previewElement.remove();

        this.previewElement = document.createElement("video");
        Object.assign(this.previewElement, { autoplay: true, muted: true, playsInline: true });
        Object.assign(this.previewElement.style, {
            width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%"
        });

        // Источником превью всегда является наш стабильный поток с Canvas
        this.previewElement.srcObject = this.stream;
        Object.assign(this.videoSource.style, {
            position: "absolute", inset: "0", opacity: "0", pointerEvents: "none"
        });
        container.replaceChildren(this.videoSource, this.previewElement);
    }

    /**
     * ***************************************************************************
     * Запуск интервала для отсчета времени записи
     * @private
     * ***************************************************************************
     */
    _startTimer(): void {
        if (this.timerInterval) clearInterval(this.timerInterval);
        this.timerInterval = setInterval(() => {
            if (!this.isRecording || this.isPaused) return;
            this.elapsedMs = Date.now() - this.startTime - this.pausedDuration;
            if (this.onTimeUpdate) this.onTimeUpdate(this.getFormattedTime());
        }, 100);
    }

    /**
     * ***************************************************************************
     * Форматирование текущего времени записи (MM:SS)
     * @returns {string}
     * ***************************************************************************
     */
    getFormattedTime(): string {
        const sec = Math.floor(this.elapsedMs / 1000);
        const m = Math.floor(sec / 60).toString().padStart(2, "0");
        const s = (sec % 60).toString().padStart(2, "0");
        return `${m}:${s}`;
    }

    /**
     * ***************************************************************************
     * Полная очистка ресурсов и остановка всех потоков
     * @private
     * ***************************************************************************
     */
    _cleanup(): void {
        Logger.debug("[VideoRecorder] Cleaning up resources...");

        // Сбрасываем логи
        this.isRecording = false;
        this.isPaused = false;

        // Сбрасываем animationFrame
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        // Сбрасываем timerInterval
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }

        // Сбрасываем фильтры на канвасе
        if (this.ctx) this.ctx.filter = 'none';

        // Останавливаем аппаратные ресурсы
        if (this.videoSource) {
            this.videoSource.pause(); // Сначала пауза
            // srcObject типизирован как MediaProvider, но здесь всегда
            // MediaStream — сужаем через instanceof (invariant)
            const sourceStream = this.videoSource.srcObject;
            if (sourceStream instanceof MediaStream) {
                sourceStream.getTracks().forEach(t => t.stop());
                this.videoSource.srcObject = null;
            }
        }

        // Сбрасываем stream
        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
        }

        // Очищаем оставшиеся данные
        this.chunks = [];
        this.recorder = null;

    }

}