// Импортируем сторонние пакеты
import { v7 as Uuidv7 } from "uuid";

// Импортируем utils
import { Logger } from "../../../utils/logs/logger.js";
import { VideoRecorder } from "../../../utils/video/video_note_recorder.js";
import { Icons } from "../../../utils/icons.js";
import { buildLocalMediaMetadata } from "../../../utils/media/local_media_metadata.js";

// Импортируем components
import { ProgressIndicator } from "../../../components/progress.js";

// Импортируем функции
import { updateStateButtons } from "./update_state_buttons.js";
import { getSessionUserId, getSessionUserDisplayName } from "../../main/functions/session_identity.js";

// Импортируем config
import { TEMP_MESSAGE, MESSAGE_MAX_RECORDING_VIDEO_NOTE_MS } from "../../../config/constants.js";

// Импортируем типы
import type { MediaMetadata } from "../../../types/media.js";
import type { AttachmentsRaw } from "../../../utils/messages/attachments.js";
import { getErrorName } from "../../../utils/helpers/error_util.js";
import type { MessageRecord } from "../types.js";
import type { Messages } from "../index.js";

/** Объект-мап вложений черновика (тот же тип, что хранит MessageRecord.attachments). */
type AttachmentsMap = Extract<AttachmentsRaw, Record<string, unknown>>;

/**
 * ***************************************************************************
 * VideoNoteSession - класс-контроллер для управления записью видео-кружочка
 * в конкретной форме. Управляет UI панели записи: таймер, кольцо прогресса,
 * смена камеры, пауза/продолжение и остановка записи.
 * ***************************************************************************
 */
export class VideoNoteSession {

    /** Форма, которой принадлежит сессия. */
    form: Messages;

    /** Контейнер превью записи. */
    previewContainer: HTMLElement | null;

    /** Контейнер видео-потока записи. */
    videoWrap: HTMLElement | null;

    /** Контейнер кольца прогресса. */
    progressWrap: HTMLElement | null;

    /** Отображение таймера записи. */
    timerContent: HTMLElement | null;

    /** Кнопка паузы. */
    pauseBtn: HTMLElement | null;

    /** Футерная кнопка записи (во время записи — отмена). */
    recordBtn: HTMLElement | null;

    /** Рекордер видео-кружочка. */
    recorder: VideoRecorder;

    /** Индикатор прогресса записи. */
    progress: ProgressIndicator;

    /** Флаг блокировки двойного запуска записи. */
    isStarting: boolean = false;

    /** Защита от завершения запуска после отмены или закрытия формы. */
    startToken = 0;

    /**
     * ***************************************************************************
     * Конструктор сессии записи.
     * @param form - Форма сообщений.
     * ***************************************************************************
     */
    constructor(form: Messages) {

        // Записываем форму
        this.form = form;

        // Шаблон обязателен к моменту создания сессии (запись доступна
        // только из открытой формы) — отсутствие это ошибка
        const tpl = form.tpl;
        if (!tpl) throw new Error("[video-note]: не найден шаблон формы");

        // Кэшируем элементы конкретно этой формы
        this.previewContainer = tpl.querySelector<HTMLElement>(":scope [data-video-note-preview]");
        this.videoWrap = tpl.querySelector<HTMLElement>(":scope [data-video-wrap]");
        this.progressWrap = tpl.querySelector<HTMLElement>(":scope [data-video-note-progress-wrap]");
        this.timerContent = tpl.querySelector<HTMLElement>(":scope [data-video-note-timer-value]");
        this.pauseBtn = tpl.querySelector<HTMLElement>(":scope [action-video-note-pause]");
        this.recordBtn = tpl.querySelector<HTMLElement>(":scope >.footer [action-video-recorder]");

        // Записываем рекордер
        this.recorder = new VideoRecorder();
        this.progress = new ProgressIndicator({ width: "100%", strokeWidth: 2, radius: 20 });

        // Привязываем методы
        this.onTimeUpdate = this.onTimeUpdate.bind(this);

    }

    /**
     * ***************************************************************************
     * Старт записи.
     * @returns Promise<void>
     * ***************************************************************************
     */
    async start(): Promise<void> {

        if (this.isStarting) return; // Блокировка двойного запуска
        this.isStarting = true;
        const startToken = ++this.startToken;

        try {

            this.recorder.onTimeUpdate = this.onTimeUpdate;

            if (this.progressWrap) {
                this.progressWrap.innerHTML = "";
                this.progressWrap.appendChild(this.progress.getElement());
            }

            // Камера пишет в контейнер видео — без него стартовать не из чего
            if (!this.videoWrap) throw new Error("[video-note]: не найден контейнер видео");

            // Панель должна быть видна и во время запроса разрешений/запуска
            // камеры, а не только после первого события MediaRecorder.
            this.activateUI();
            this.progress.setProcessing();
            await this.recorder.start(this.videoWrap);
            if (startToken !== this.startToken) {
                this.recorder._cleanup();
                return;
            }
            this.progress.stopProcessing();
            if (this.recorder.isRecording) updateStateButtons(this.form);
            else this.cancel();

        } catch (error) {

            // Если это AbortError от play(), мы можем его игнорировать или логировать тихо
            if (getErrorName(error) !== "AbortError") {
                Logger.error(error);
            }
            this.cancel();

        } finally {
            this.isStarting = false;
        }

    }

    /**
     * ***************************************************************************
     * Обработка тиков таймера.
     * @param time - Отформатированное время записи.
     * @returns void
     * ***************************************************************************
     */
    onTimeUpdate(time: string): void {

        if (this.timerContent) this.timerContent.textContent = time;

        const elapsedMs = this.recorder.elapsedMs;
        const percent = (elapsedMs / MESSAGE_MAX_RECORDING_VIDEO_NOTE_MS) * 100;
        this.progress.update(Math.min(percent, 100));

        // Автостоп по лимиту
        if (elapsedMs >= MESSAGE_MAX_RECORDING_VIDEO_NOTE_MS) {
            this.stop();
        }

    }

    /**
     * ***************************************************************************
     * Остановка записи и отправка кружочка (кнопка стоп в панели записи).
     * @returns Promise<void>
     * ***************************************************************************
     */
    async stop(): Promise<void> {

        // Получаем время
        const elapsed = this.recorder?.elapsedMs || 0;

        // Если запись слишком короткая — просто отменяем
        if (elapsed <= 1000) {
            this.cancel();
            return;
        }

        // Блокируем повторные вызовы, пока идет стоп
        if (!this.recorder.isRecording) return;

        try {

            // Ожидаем файл
            const videoFile = await this.recorder.stop();

            // Сбрасываем UI
            this.resetUI();

            // Без файла останавливаться некуда — как в легаси, это ошибка
            if (!videoFile) throw new Error("[video-note]: не получен файл записи");

            // Получаем миниатюру, оригинальные размеры и длительность.
            // is_video_note передаём через extra — флаг должен попасть
            // в metadata тем же путём, что и остальные поля.
            const process = await buildLocalMediaMetadata(videoFile, {
                extra: { is_video_note: true }
            });
            this.createAttachment(videoFile, process);

        } catch (e) {
            Logger.error("Stop failed", e);
            this.cancel();
        }

    }

    /**
     * ***************************************************************************
     * Отмена записи без сохранения (кнопка X в футере).
     * @returns void
     * ***************************************************************************
     */
    cancel(): void {

        ++this.startToken;

        if (this.recorder) {
            this.recorder.onTimeUpdate = null; // Убираем связь
            this.recorder._cleanup();          // Важно, чтобы в рекордере был этот метод
        }

        this.resetUI();

    }

    /**
     * ***************************************************************************
     * Пауза/продолжение записи с обновлением иконки кнопки.
     * @returns void
     * ***************************************************************************
     */
    togglePause(): void {

        const recorder = this.recorder;
        if (!recorder) return;

        if (recorder.isPaused) {
            recorder.resume();
            this._setPauseIcon("player-pause");
        } else {
            recorder.pause();
            this._setPauseIcon("player-play");
        }

    }

    /**
     * ***************************************************************************
     * Смена камеры.
     * @returns Promise<void>
     * ***************************************************************************
     */
    async switchCamera(): Promise<void> {
        return await this.recorder.toggleCamera();
    }

    /**
     * ***************************************************************************
     * Логика создания вложения.
     * @param file - Записанный файл кружочка.
     * @param process - Метадата (миниатюра, размеры, длительность).
     * @returns void
     * ***************************************************************************
     */
    createAttachment(file: File, process: MediaMetadata): void {

        // Создаем вложение
        let attach: AttachmentsMap[string] = {
            _file: file,
            size: file.size,
            temp_id: crypto.randomUUID(),
            file_name: file.name,
            name: file.name,
            mime_type: file.type,
            // Метадата уже собрана оркестратором вместе с флагом is_video_note
            metadata: process
        };

        // invariant: temp_id присваивается этой же функцией выше через
        // crypto.randomUUID() — undefined быть не может (тип мапы лишь
        // помечает поле опциональным)
        const tempId = attach.temp_id!;

        // Если есть временное сообщение
        if (this.form.tempMessage) {

            // invariant: черновик создаётся локально — вложения в нём объект-мап
            const attachments = this.form.tempMessage.attachments as AttachmentsMap;
            attachments[tempId] = attach;
            this.form.store.update(this.form.tempMessage.id, this.form.tempMessage);

        } else {

            // Канал и поле ввода обязательны к моменту записи —
            // отсутствие обрывает создание через общий catch
            const channel = this.form.channel;
            const textarea = this.form.textarea;
            if (!channel || !textarea) throw new Error("[video-note]: нет канала или поля ввода");

            // Создаем временное сообщение (тип задаём заранее: поле формы хранит
            // запись стора, а литерал дополнительно несёт серверные поля)
            const tempMessage: MessageRecord = {
                ...TEMP_MESSAGE,
                id: Uuidv7(),
                created_user_id: getSessionUserId() ?? undefined,
                display_name: getSessionUserDisplayName(),
                channel_id: this.form.channelId,
                channel_type: channel.type,
                text: textarea.value,
                reply_to_message_id: this.form.replyMessage?.id || null,
                reply_to_message: this.form.replyMessage || null,
                created_at: new Date().toISOString(),
                attachments: { [tempId]: attach }
            };

            this.form.tempMessage = tempMessage;

            // Добавляем на форму
            this.form.store.add(tempMessage);

            // Обновляем состояние кнопок
            updateStateButtons(this.form);

        }

    }

    /**
     * ***************************************************************************
     * Активация UI при старте записи.
     * @returns void
     * ***************************************************************************
     */
    activateUI(): void {

        this.progress.update(0);
        this.progress.show();
        this.previewContainer?.classList.remove("hidden");

        // Футерная кнопка записи становится кнопкой отмены (X)
        if (this.recordBtn) {
            this.recordBtn.classList.add("error");
            this.recordBtn.innerHTML = Icons.icon("x", { settings: { stroke: 3 } })?.outerHTML ?? "";
        }

        // Сбрасываем иконку паузы
        this._setPauseIcon("player-pause");

        // Сбрасываем таймер
        if (this.timerContent) this.timerContent.textContent = "00:00";

        updateStateButtons(this.form);

    }

    /**
     * ***************************************************************************
     * Сброс UI после остановки/отмены записи.
     * @returns void
     * ***************************************************************************
     */
    resetUI(): void {

        this.progress.destroy();
        this.previewContainer?.classList.add("hidden");

        // Футерная кнопка снова запускает запись
        if (this.recordBtn) {
            this.recordBtn.classList.remove("error");
            this.recordBtn.innerHTML = Icons.icon("Video")?.outerHTML ?? "";
        }

        // Сбрасываем иконку паузы
        this._setPauseIcon("player-pause");

        // Сбрасываем таймер
        if (this.timerContent) this.timerContent.textContent = "00:00";

        updateStateButtons(this.form);

    }

    /**
     * ***************************************************************************
     * Установка иконки кнопки паузы.
     * @param iconName - Имя иконки ("player-pause" | "player-play").
     * @returns void
     * ***************************************************************************
     */
    _setPauseIcon(iconName: string): void {

        if (!this.pauseBtn) return;
        this.pauseBtn.innerHTML = Icons.icon(iconName, { settings: { filled: true } })?.outerHTML ?? "";

    }

}
