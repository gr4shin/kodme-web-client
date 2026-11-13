// Импортируем сторонние пакеты
import { OverlayScrollbars } from "overlayscrollbars";

// Импортируем utils
import { Logger } from "../../utils/logs/logger.js";
import { Store } from "../../utils/store.js";
import { Overlay } from "../../components/overlay/index.js";
import { TextareaAutosize } from "../../utils/helpers/textarea_autosize.js";
import { ScrollManager } from "../../core/managers/scroll_manager.js";
import { SvgMaskManager } from "../../core/managers/svg_mask_manager.js";
import { LocalStorage } from "../../utils/local_storage.js";
import { Buttons } from "../../components/buttons.js";
import { Inputs } from "../../components/inputs.js";
import { Icons } from "../../utils/icons.js";
import { t } from "../../utils/i18n/index.js";
import { getErrorCode, getErrorName } from "../../utils/helpers/error_util.js";
import { CDM_FORM_CLASSES, CDM_FORM_HEADER_CLASSES, CDM_FORM_CONTENT_CLASSES } from "../../config/constants.js";

// Импортируем functions
import { firstLoadComments } from "./functions/first_load_comments.js";
import { intersection } from "./functions/intersection.js";
import { VoiceNoteSession } from "./functions/voice_note_session.js";
import { VideoNoteSession } from "./functions/video_note_session.js";
import { CommentReactionsUpdater, stopCommentReactionsPolling } from "./functions/comment_reactions_updater.js";
import { CommentLastViewedBatcher } from "./functions/comment_last_viewed_batcher.js";
import { updateLastViewedCommentRequest } from "./requests/update_last_viewed_comment.js";

// Импортируем components
import { renderPostHeader } from "./components/post_header.js";

// Импортируем events
import { subscribeStoreEvents, unsubscribeStoreEvents } from "./events/store/store_events.js";
import { subscribeUpdateLastViewedComment } from "./events/socket/update_last_viewed_comment.js";

// Импортируем requests
import { commentOpenRequest } from "./requests/comment_open.js";

// Импортируем обработчики
import { onContentScrollHandler } from "./handlers/on_content_scroll.js";
import { scrollDownHandler } from "./handlers/scroll_down.js";
import { createCommentHandler } from "./handlers/create_comment.js";
import { updateCommentHandler } from "./handlers/update_comment.js";
import { cancelEditCommentHandler } from "./handlers/cancel_edit_comment.js";
import { onInputTextareaHandler } from "./handlers/on_input_textarea.js";
import { attachDocumentHandler } from "./handlers/attach_document.js";
import { dragAndDropFilesHandler } from "./handlers/drag_and_drop_files.js";
import { textareaPasteBufferHandler } from "./handlers/textarea_paste_buffer.js";
import { emojiHandler } from "./handlers/emoji.js";
import { voiceNotePointerHandler } from "./handlers/voice_note_pointer.js";
import { switchCameraVideoNoteHandler } from "./handlers/switch_camera_video_note.js";
import { pauseResumeVideoNoteHandler } from "./handlers/pause_resume_video_note.js";
import { stopVideoNoteHandler } from "./handlers/stop_video_note.js";

// Импортируем типы
import type { GestureController } from "../../utils/gesture_controller.js";
import type { CommentRecord, CommentsDirection, CommentsFormData, CommentsFormOptions, PendingAck } from "./types.js";
import type { CommentOpenResult } from "./requests/comment_open.js";
import type { DragAndDropHandle } from "./handlers/drag_and_drop_files.js";
import type { MessageData } from "../messages/components/types.js";

// Form
export class Comments {

    // Реестр всех открытых форм Comments: { postId: instance }
    static instances = new Map<string, Comments>();

    /**
     * ***************************************************************************
     * Форма комментариев поста.
     * @param data - Данные.
     * @param data.postId - Id поста (сообщения).
     * @param data.channelId - Id канала поста.
     * @param data.options - Настройки формы.
     * @param data.options.insertInto - Куда вставить форму.
     * ***************************************************************************
     */
    constructor(data: CommentsFormData) {

        // Если не передан postId
        if (!data?.postId) throw new Error("Не передан: postId");

        // Устанавливаем настройки
        this.options = {
            insertInto: document.querySelector<HTMLElement>(".cdm-form.home .middle .form-container"),
            ...data?.options
        }

        // Каркас формы
        this.tpl = null;
        this.modal = null;
        this.svgMaskManager = null;
        this.content = null;
        this.list = null;
        this.postContainer = null;
        this.textarea = null;
        this.textareaAutosize = null;
        this.osListScrollInstance = null;                   // overlayScroll instance
        this.listScrollManager = null;                      // Менеджер скролла
        this.scrollDownBtn = null;
        this.name = null;
        this.subtitle = null;
        this.wrapFooter = null;
        this.replyContainer = null;
        this.editContainer = null;

        // Данные ветки
        this.postId = data.postId;                          // Id поста (сущность-владелец)
        this.channelId = data.channelId;                    // Id канала поста
        this.post = null;                                   // данные поста (шапка)
        this.lastViewedCommentId = null;                    // позиция возврата (разделитель)
        this.firstCommentId = null;                         // граница ветки (самый старый)
        this.lastCommentId = null;                          // граница ветки (самый новый)
        this.isCommentingAllowed = true;                    // можно ли писать в ветку
        this.observer = null;
        this.editedComment = null;                          // редактируемый комментарий
        this.replyComment = null;                           // комментарий, на который отвечаем
        this.uploadAbort = null;                            // контроллер прерывания очереди отправки
        this.pendingAcks = null;                            // ожидания ack исходящих комментариев

        // Флаг подзагрузки комментариев (защита от параллельных запросов)
        this.isCommentsLoading = false;

        // Состояние окна ленты
        this.newDividerBeforeId = null;                     // id комментария перед разделителем «Новые комментарии»
        this.newDividerObserver = null;                     // observer разделителя (уход за экран снимает его)
        this._lastInsertDirection = null;                   // направление последней вставки ("prev"/"next")
        this._listSyncInit = false;
        this._listSyncScheduled = false;
        this._listSyncing = false;
        this._stickToBottom = false;                        // «дёрнуть список вниз» после синхронизации пачки

        // Черновик и очередь отправки (память — без IndexedDB)
        this.tempComment = null;                            // черновик (вложения до отправки)
        this.pendingIds = new Set();                        // локальные id исходящих, ждущих эхо

        // Drag&drop вложений
        this.isDropActive = false;
        this.dragDropHandle = null;

        // Сессии записи (голосовое/видео-кружок)
        this.voiceRecorder = null;                          // индикатор идущей голосовой записи
        this.voiceNoteSession = null;                       // сессия голосовых (создаётся по требованию)
        this.voiceNoteGestureController = null;             // контроллер жестов микрофона
        this.videoNoteRecorder = null;                      // сессия видео-кружка (в _onOpen)
        this.commentReactionsUpdater = null;                // поллинг реакций (в _onOpen)

        // Подписки на события Store
        this.storeUnsubs = [];

        // Хранилище списка комментариев (только память — без IndexedDB)
        this.store = new Store<CommentRecord>();

        // Батчер отметки «прочитано до»: отправляем только последнее значение
        // с задержкой, чтобы при быстром скролле не жечь лимит запросов
        this.lastViewedBatcher = new CommentLastViewedBatcher({
            context: "[app][comments][last-viewed]",
            flushCallback: async (commentId: string) => {

                try {

                    // Отправляем позицию чтения на сервер (двигается только вперёд)
                    await updateLastViewedCommentRequest({
                        entity_id: this.postId,
                        entity_type: "message",
                        comment_id: commentId
                    });

                    // Запоминаем локально: разделитель «Новые комментарии»
                    // больше не нужен, если он уже позади
                    this.lastViewedCommentId = commentId;

                } catch (error) {

                    // Гонка удаления: комментарий удалили между schedule и
                    // flush — сервер считает его отсутствующим
                    // (COMMENT_MISMATCH 131901). Отметка не критична
                    // (позиция двигается только вперёд) — тихий лог вместо ERROR
                    const name = getErrorName(error);
                    const code = getErrorCode(error);
                    if (name === "COMMENT_MISMATCH" || code === "131901") {
                        Logger.debug(`[app][comments][last-viewed]: комментарий ${commentId} уже удалён — отметка пропущена.`);
                        return;
                    }

                    // Прочие ошибки отдаём батчеру — он залогирует их сам
                    throw error;

                }

            }
        });

        // Получаем instance
        let instance = Comments.instances.get(data.postId);
        if (instance) return instance;

        // Регистрируем этот экземпляр формы
        Comments.instances.set(this.postId, this);

        // Инициализация
        this._init();

    }

    // Настройки формы
    options: CommentsFormOptions;

    // Каркас формы
    tpl: HTMLElement | null;
    modal: Overlay | null;
    svgMaskManager: SvgMaskManager | null;
    content: HTMLElement | null;
    list: HTMLElement | null;
    postContainer: HTMLElement | null;
    textarea: HTMLTextAreaElement | null;
    textareaAutosize: TextareaAutosize | null;
    osListScrollInstance: OverlayScrollbars | null;
    listScrollManager: ScrollManager | null;
    scrollDownBtn: HTMLElement | null;
    name: HTMLElement | null;
    subtitle: HTMLElement | null;
    wrapFooter: HTMLElement | null;
    replyContainer: HTMLElement | null;
    editContainer: HTMLElement | null;

    // Данные ветки
    postId: string;
    channelId: string;
    post: MessageData | null;
    lastViewedCommentId: string | null;
    firstCommentId: string | null;
    lastCommentId: string | null;
    isCommentingAllowed: boolean;

    // Состояние
    observer: IntersectionObserver | null;
    isCommentsLoading: boolean;
    editedComment: CommentRecord | null;
    replyComment: CommentRecord | null;
    uploadAbort: AbortController | null;
    pendingAcks: Map<string, PendingAck> | null;

    // Состояние окна ленты
    newDividerBeforeId: string | null;
    newDividerObserver: IntersectionObserver | null;
    _lastInsertDirection: CommentsDirection | null;
    _listSyncInit: boolean;
    _listSyncScheduled: boolean;
    _listSyncing: boolean;
    _scheduleListSync?: () => void;
    _stickToBottom: boolean;

    // Черновик и очередь отправки (память — без IndexedDB)
    tempComment: CommentRecord | null;
    pendingIds: Set<string>;

    // Drag&drop вложений
    isDropActive: boolean;
    dragDropHandle: DragAndDropHandle | null;

    // Сессии записи (голосовое/видео-кружок)
    voiceRecorder: unknown;
    voiceNoteSession: VoiceNoteSession | null;
    voiceNoteGestureController: GestureController | null;
    videoNoteRecorder: VideoNoteSession | null;
    commentReactionsUpdater: CommentReactionsUpdater | null;
    lastViewedBatcher: CommentLastViewedBatcher | null;

    // Подписки на события Store
    storeUnsubs: Array<() => void>;

    // Хранилище комментариев
    store: Store<CommentRecord>;

    // ***************************************************************************
    // Инициализация
    // ***************************************************************************
    async _init(): Promise<void> {

        // Подписываемся на события Store
        subscribeStoreEvents(this);

        // Открытие
        await this._open();

    }

    // ***************************************************************************
    // Открытие
    // ***************************************************************************
    async _open(): Promise<void> {

        try {

            // Шаблон формы
            const tpl = this._template();
            if (!tpl) {
                Logger.error("[app][comments]: Не удалось построить шаблон формы");
                return;
            }
            this.tpl = tpl;

            // Форма
            this.modal = new Overlay(tpl, {
                type: "form",
                url: `?comments=${this.postId}`,
                insertInto: this.options.insertInto,
                closeOnEsc: false,
                closeOnOverlay: false,
                onBeforeOpen: async () => await this._onBeforeOpen(),
                onOpen: async () => await this._onOpen(),
                onBeforeClose: () => this._onBeforeClose(),
                openAnimationClass: null,
                closeAnimationClass: null
            });

            // Открываем форму
            this.modal.open();

        } catch (error) {
            Logger.error(error);
        }

    }

    // ***************************************************************************
    // Обработчики
    // ***************************************************************************
    _handlers(): void {

        try {

            // Каркас и его узлы создаются в _open/_onBeforeOpen — без них
            // обвешивать обработчиками нечего
            if (!this.tpl || !this.modal) return;

            // Закрыть
            let close = this.tpl.querySelector(":scope >.header [action-close]");
            close?.addEventListener("click", () => this.modal?.close());

            // Прокрутить вниз (кнопка появляется при удалении от хвоста)
            let scrollDown = this.tpl.querySelector(":scope >[action-scroll-down]");
            scrollDown?.addEventListener("click", () => scrollDownHandler(this));

            // Отправка комментария по кнопке
            let createComment = this.tpl.querySelector(":scope >.footer [action-create-comment]");
            createComment?.addEventListener("click", () => createCommentHandler(this));

            // Сохранение отредактированного комментария (кнопка в футере)
            let updateComment = this.tpl.querySelector(":scope >.footer [action-update-comment]");
            updateComment?.addEventListener("click", () => updateCommentHandler(this));

            // Отмена редактирования (кнопка в футере; крестик футера — свой
            // обработчик в footer_edit_comment)
            let cancelEdit = this.tpl.querySelector(":scope >.footer [action-cancel-edit]");
            cancelEdit?.addEventListener("click", () => cancelEditCommentHandler(this));

            // Кнопка «Прикрепить файл»
            let attachFile = this.tpl.querySelector(":scope >.footer [action-attach-file]");
            attachFile?.addEventListener("click", () => attachDocumentHandler(this));

            // Панель эмодзи (вставка выбранного символа в поле ввода)
            let emoji = this.tpl.querySelector(":scope >.footer [action-emoji]");
            emoji?.addEventListener("click", () => emojiHandler(this));

            // Ввод текста: Enter (десктоп, без Shift) — отправка; на каждом
            // изменении пересчитываются кнопки футера
            this.textarea?.addEventListener("keydown", (event) => onInputTextareaHandler(event, this));
            this.textarea?.addEventListener("input", (event) => onInputTextareaHandler(event, this));

            // Вставка из буфера обмена (текст/файлы)
            this.textarea?.addEventListener("paste", (event) => textareaPasteBufferHandler(event, this));

            // Запись голосового комментария (тап — закреплённая запись,
            // удержание + свайп вверх — отмена, повторный тап — отмена)
            let recordVoice = this.tpl.querySelector<HTMLElement>(":scope >.footer [data-note-recorder]");
            if (recordVoice) voiceNotePointerHandler(this, recordVoice);

            // Отмена записи голосового (кнопка X на панели)
            let cancelVoiceNote = this.tpl.querySelector(":scope [action-voice-note-cancel]");
            cancelVoiceNote?.addEventListener("click", () => this.voiceNoteSession?.cancel());

            // Пауза/продолжение записи голосового (кнопка на панели)
            let pauseVoiceNote = this.tpl.querySelector(":scope [action-voice-note-pause]");
            pauseVoiceNote?.addEventListener("click", () => this.voiceNoteSession?.togglePause());

            // Отправить голосовой комментарий (кнопка на панели)
            let sendVoiceNote = this.tpl.querySelector(":scope [action-voice-note-send]");
            sendVoiceNote?.addEventListener("click", () => this.voiceNoteSession?.stop());

            // =========================

            // Запись видео-кружка

            // Смена камеры в видео-кружке
            let switchCameraVideoNote = this.tpl.querySelector(":scope [action-video-note-switch-camera]");
            switchCameraVideoNote?.addEventListener("click", () => switchCameraVideoNoteHandler(this));

            // Пауза/продолжение записи кружка
            let pauseRecordVideoNote = this.tpl.querySelector(":scope [action-video-note-pause]");
            pauseRecordVideoNote?.addEventListener("click", () => pauseResumeVideoNoteHandler(this));

            // Остановить запись кружка (ложится в черновик)
            let stopRecordVideoNote = this.tpl.querySelector(":scope [action-video-note-stop]");
            stopRecordVideoNote?.addEventListener("click", () => stopVideoNoteHandler(this));

            // =========================

            // При скролле ленты: подгрузка страниц у краёв + кнопка «вниз»
            // (список захватывается сейчас: чтение свойства в замыкании
            // сужение не сохраняет)
            const list = this.list;
            if (list) {
                this.osListScrollInstance?.on("scroll", (osInstance) => {
                    const viewport = osInstance.elements().viewport;
                    onContentScrollHandler(this, viewport, list.children);
                });
            }

            // Ответ/редактирование/удаление/реакции живут в жестах самой
            // строки (comment_row_actions + components/handlers/)

        } catch (error) {
            Logger.error(error);
        }

    }

    // ***************************************************************************
    // Настройка формы
    // ***************************************************************************
    async _onBeforeOpen(): Promise<boolean | void> {

        try {

            // Шаблон и модалка создаются в _open до вызова хука
            if (!this.tpl || !this.modal) return;

            // Декоративный фон чата (парный блоку из messages/index.ts — правь
            // оба!): при включённой декорации на форму раскладываются слои
            // SvgMaskManager — градиент и повторяющийся SVG-паттерн, как у
            // сообщений. Без session просто пропускаем: открытие комментариев
            // от наличия настроек не зависит
            const session = LocalStorage.session;
            if (session?.settings?.user?.decorations?.chat_background?.enabled) {

                this.svgMaskManager = new SvgMaskManager(this.tpl, `${session.settings.user.decorations.chat_background.src}`);
                await this.svgMaskManager.init();

            }

            // Получаем контейнеры
            this.content = this.tpl.querySelector(":scope >.content");
            this.list = this.tpl.querySelector(":scope >.content [data-list]");
            this.postContainer = this.tpl.querySelector(":scope >.content [data-post-container]");

            // textarea и футер
            this.textarea = this.tpl.querySelector<HTMLTextAreaElement>(`:scope >.footer [name="comment"]`);
            this.wrapFooter = this.tpl.querySelector(":scope >.footer .wrap-footer");

            // Контейнеры футеров ответа и редактирования (над полем ввода)
            this.replyContainer = this.tpl.querySelector(":scope >.footer [data-reply-container]");
            this.editContainer = this.tpl.querySelector(":scope >.footer [data-edit-container]");

            // Кнопка прокрутки вниз
            this.scrollDownBtn = this.tpl.querySelector(":scope >[action-scroll-down]");

            // Открываем ветку на сервере: пост + позиция возврата + подписки
            let response = await commentOpenRequest({
                entity_id: this.postId,
                entity_type: "message"
            });

            // Данные ответа обязательны — без них нечего рендерить
            const result = response.data;
            if (!result) throw new Error("Не смогли открыть комментарии");

            // Обновляем форму
            this.update(result);

            // Сообщаем системе, что форма открыта
            window.dispatchEvent(new CustomEvent("[app][form]::opened", {
                detail: {
                    id: this.modal.options.id,
                    data: {
                        instance: this,
                        title: t("forms.comments.title"),
                        subtitle: ""
                    }
                }
            }));

        } catch (error) {
            Logger.error(error);
        }

    }

    // ***************************************************************************
    // Форма открылась
    // ***************************************************************************
    async _onOpen(): Promise<void> {

        // Узлы выставляет _onBeforeOpen: без textarea и контейнера
        // инициализировать автосайз/скролл не из чего
        if (!this.textarea || !this.content) return;

        // Заставляем textarea автоматически подстраиваться под контент
        this.textareaAutosize = new TextareaAutosize(this.textarea);

        // Инициализируем скроллбар
        this.osListScrollInstance = OverlayScrollbars(this.content, {
            scrollbars: { autoHide: "scroll" }, overflow: { x: "hidden", y: "scroll" }
        });

        // Инициируем скролл менеджер
        this.listScrollManager = new ScrollManager(this.osListScrollInstance);

        // Запускаем наблюдатель видимости строк (реакции, прочтение;
        // root — viewport скролла ленты)
        this.observer = new IntersectionObserver((entries, observer) => {
            intersection(entries, observer, this);
        }, {
            root: this.osListScrollInstance.elements().viewport,
            rootMargin: "0px 0px -5% 0px",
            threshold: [0, 0.01, 0.1]
        });

        // Устанавливаем обработчики
        this._handlers();

        // Подписка на перетаскивание файлов в ленту (отписка — в _onBeforeClose)
        this.dragDropHandle = dragAndDropFilesHandler(this);

        // Сессия записи видео-кружка (элементы панели кэшируются в конструкторе,
        // поэтому создание возможно только после открытия шаблона)
        this.videoNoteRecorder = new VideoNoteSession(this);

        // Менеджер поллинга реакций видимых комментариев (запуск — лениво,
        // из intersection при первой видимой строке)
        this.commentReactionsUpdater = new CommentReactionsUpdater(this);

        // Подписка на своё эхо отметки «прочитано до» (снятие разделителя
        // «Новые комментарии» при прочтении ветки за один заход). Отписка
        // складывается в storeUnsubs — гасится unsubscribeStoreEvents в
        // _onBeforeClose
        this.storeUnsubs.push(subscribeUpdateLastViewedComment(this) ?? (() => { }));

        // Получаем комментарии
        firstLoadComments(this);

    }

    // ***************************************************************************
    // Обновляем данные формы
    // @param data - Ответ [comment]: open.
    // ***************************************************************************
    update(data: CommentOpenResult): void {

        // Если нет данных
        if (!data) return;

        // Записываем данные ветки
        this.post = data.message;
        this.lastViewedCommentId = data.last_viewed_comment_id;
        this.isCommentingAllowed = data.is_commenting_allowed;

        // Каркас создаётся в _open: без шаблона заполнять нечего
        if (!this.tpl) return;

        // Заголовок и подзаголовок формы
        this.name = this.tpl.querySelector(":scope >.header [data-name]");
        this.subtitle = this.tpl.querySelector(":scope >.header [data-subtitle]");

        // Заголовок — «Комментарии», подзаголовок — число комментариев поста
        if (this.name) this.name.textContent = t("forms.comments.title");
        if (this.subtitle) {

            const total = data.message.count_comments ?? 0;
            this.subtitle.textContent = `${total} ${t("forms.comments.dec_comments", { count: total })}`;

        }

        // Карточка поста в шапке ленты
        if (this.postContainer) {

            // Очищаем контейнер и вставляем свежую карточку
            this.postContainer.innerHTML = "";
            const card = renderPostHeader(this);
            if (card) this.postContainer.append(card);

        }

        // Футер скрываем, когда писать нельзя (комментарии выключены
        // в сообществе или под постом) — чтение при этом остаётся
        if (this.wrapFooter) this.wrapFooter.classList.toggle("hidden", !this.isCommentingAllowed);

    }

    // ***************************************************************************
    // Действия при закрытии формы
    // ***************************************************************************
    async _onBeforeClose(): Promise<void> {

        // Отписываемся от событий Store (item::added / item::removed)
        unsubscribeStoreEvents(this);

        // Останавливаем идущие записи и снимаем жесты микрофона — иначе
        // камера/микрофон остались бы заняты после закрытия формы
        this.voiceNoteGestureController?.destroy();
        this.voiceNoteGestureController = null;

        if (this.voiceRecorder || this.voiceNoteSession?.isStarting || this.voiceNoteSession?.isStopping) {
            this.voiceNoteSession?.cancel();
        }

        if (this.videoNoteRecorder?.isStarting || this.videoNoteRecorder?.recorder?.isRecording) {
            this.videoNoteRecorder.cancel();
        }

        this.voiceNoteSession = null;
        this.videoNoteRecorder = null;

        // Останавливаем поллинг реакций (запрос мог вернуться после закрытия)
        stopCommentReactionsPolling(this);

        // Досылаем и гасим батчер отметки «прочитано до»: позиция чтения
        // не должна потеряться при закрытии формы
        await this.lastViewedBatcher?.flush();
        this.lastViewedBatcher?.destroy();

        // Снимаем обработчики перетаскивания файлов
        this.dragDropHandle?.destroy();
        this.dragDropHandle = null;

        // Прерываем цикл отправки комментариев и загрузки файлов
        this.uploadAbort?.abort();

        // Освобождаем ожидания ack: иначе обработчик пуша `[comment]: new`
        // ждал бы до таймаута уже несуществующую форму
        for (const entry of this.pendingAcks?.values() || []) entry.resolve?.();
        this.pendingAcks?.clear();

        // Очищаем черновик и очередь (живут только в памяти — без IndexedDB
        // после закрытия формы они не восстанавливаются)
        this.tempComment = null;
        this.pendingIds?.clear();

        // Очищаем хранилище
        this.store?.removeAll();

        // Сбрасываем состояние редактирования и ответа
        this.editedComment = null;
        this.replyComment = null;

        // Удаляем экземпляр формы из реестра
        Comments.instances.delete(this.postId);

        // Отключаем наблюдение строк, чтобы избежать утечек памяти
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }

        // Отключаем observer разделителя «Новые комментарии»
        this.newDividerObserver?.disconnect();
        this.newDividerObserver = null;
        this.newDividerBeforeId = null;

        // Сбрасываем состояние окна ленты
        this._lastInsertDirection = null;
        this._listSyncScheduled = false;
        this._listSyncing = false;
        this._stickToBottom = false;

        // Сообщаем системе, что форма закрыта
        window.dispatchEvent(new CustomEvent("[app][form]::closed", {
            detail: { id: this.modal?.options.id }
        }));

    }

    // ***************************************************************************
    // Шаблон формы
    // ***************************************************************************
    _template(): HTMLElement | null {

        // Иконка подсказки «свайп вверх — отмена» на панели голосового
        const slideToCancelIcon = Icons.icon("arrow-left", { settings: { stroke: 2.5 } })?.outerHTML ?? "";

        // Мы используем DOMParser для создания DOM без innerHTML
        return new DOMParser().parseFromString(`

            <div class="cdm-form comments flex flex-col ${CDM_FORM_CLASSES()} w-full">
                <div class="header flex flex-row gap-2 p-2 items-center justify-between ${CDM_FORM_HEADER_CLASSES()}">
                    <div class="flex flex-row w-full gap-2 items-center overflow-hidden">
                        ${Buttons.create({ intent: "transparent", shape: "circle", attributes: ["action-close"], icon: "ArrowLeft" })}
                        <div class="flex flex-col gap-0 overflow-hidden">
                            <span data-name class="flex flex-row gap-2 items-center font-semibold truncate"></span>
                            <span data-subtitle class="text-xs text-secondary truncate"></span>
                        </div>
                    </div>
                </div>

                <div class="content w-full h-full flex flex-col bg-[var(--color-black)]/5 dark:bg-[var(--color-black)]/20 ${CDM_FORM_CONTENT_CLASSES()}">
                    <div data-post-container class="flex flex-col w-full shrink-0 border-b border-[var(--border-color)]"></div>
                    <div data-list class="flex flex-col gap-0 w-full"></div>
                </div>

                ${Buttons.primary({ shape: "circle", attributes: ["action-scroll-down"], icon: "ArrowBigDown" })}
                <div data-video-note-preview class="relative flex flex-col gap-3 hidden">
                    <div data-video-note-timer class="flex flex-row gap-2 items-center justify-center text-[var(--color-red)] font-semibold text-lg">
                        <span class="w-2.5 h-2.5 rounded-full bg-[var(--color-red)] animate-pulse"></span>
                        <span data-video-note-timer-value>00:00</span>
                    </div>
                    <div class="relative w-full h-full rounded-full overflow-hidden">
                        <div data-video-wrap class="w-full h-full overflow-hidden rounded-full overflow-hidden"></div>
                        <div data-video-note-progress-wrap class="w-full h-full pointer-events-none rounded-full overflow-hidden"></div>
                    </div>
                    <div data-video-note-action-container class="flex flex-row gap-2 shadow-sm rounded-3xl p-2 items-center bg-[var(--form-bg)]">
                        ${Buttons.create({ intent: "transparent", shape: "circle", attributes: ["action-video-note-switch-camera"], icon: "camera-rotate" })}
                        ${Buttons.create({ intent: "transparent", shape: "circle", attributes: ["action-video-note-pause"], icon: "player-pause" })}
                        ${Buttons.danger({ shape: "circle", attributes: ["action-video-note-stop"], icon: { name: "player-stop", settings: { filled: true } } })}
                    </div>
                </div>

                <div class="footer absolute flex flex-col shrink-0 gap-2 pb-[2em] max-lg:pb-0 w-full bottom-0 left-0 z-10">
                    <div data-reply-container class="flex empty:hidden w-[var(--messages-block-max-width)] max-w-[var(--messages-block-max-width)] m-auto"></div>
                    <div data-edit-container class="flex empty:hidden w-[var(--messages-block-max-width)] max-w-[var(--messages-block-max-width)] m-auto"></div>

                    <div data-voice-note-panel class="relative flex flex-row gap-2 p-2 w-full md:w-[var(--messages-block-max-width)] md:max-w-[var(--messages-block-max-width)] shadow-sm rounded-4xl max-md:rounded-none items-center m-auto bg-[var(--form-bg)] hidden">
                        ${Buttons.create({ intent: "transparent", shape: "circle", attributes: ["action-voice-note-cancel"], icon: "x" })}
                        <div class="flex flex-row gap-2 items-center justify-center shrink-0">
                            <span data-voice-note-status class="w-2.5 h-2.5 rounded-full bg-[var(--color-red)] animate-pulse"></span>
                            <span data-voice-note-timer class="text-[var(--color-red)] font-semibold tabular-nums text-sm">00:00</span>
                        </div>
                        <div data-voice-note-wave class="flex flex-row flex-1 items-center justify-center gap-0.5 h-8"></div>
                        <div class="flex flex-row gap-2 items-center shrink-0">
                            ${Buttons.create({ intent: "transparent", shape: "circle", attributes: ["action-voice-note-pause"], icon: "player-pause" })}
                            ${Buttons.danger({ shape: "circle", attributes: ["action-voice-note-send"], icon: { name: "send-2", settings: { filled: true } } })}
                        </div>
                        <div data-voice-note-cancel-hint class="hidden absolute inset-0 items-center justify-center gap-2 font-semibold text-sm text-[var(--color-red)]">
                            ${slideToCancelIcon} ${t("forms.comments.voice_recorder.slide_to_cancel")}
                        </div>
                    </div>

                    <div class="wrap-footer flex flex-row gap-0 p-2 w-full md:w-[var(--messages-block-max-width)] md:max-w-[var(--messages-block-max-width)] shadow-sm rounded-4xl max-md:rounded-none items-center m-auto bg-[var(--form-bg)]">
                        <div class="flex flex-row gap-0 h-full w-full items-end">
                            ${Buttons.create({ intent: "transparent", shape: "circle", attributes: ["action-emoji"], icon: "mood-smile" })}
                            ${Inputs.textarea({ intent: "transparent", placeholder: t("forms.comments.enter_comment"), name: "comment", rows: 1 })}
                            ${Buttons.create({ intent: "transparent", shape: "circle", attributes: ["action-attach-file"], icon: "Paperclip" })}
                            <div data-note-recorder data-recording-mode="voice" class="flex shrink-0 select-none touch-none">
                                ${Buttons.create({ intent: "transparent", shape: "circle", attributes: ["action-video-recorder"], classes: ["hidden"], icon: "Video" })}
                                ${Buttons.create({ intent: "transparent", shape: "circle", attributes: ["action-voice-recorder"], icon: "microphone" })}
                            </div>
                            ${Buttons.create({ intent: "transparent", shape: "circle", attributes: ["action-create-comment"], classes: ["hidden"], icon: "send-2" })}
                            ${Buttons.create({ intent: "transparent", shape: "circle", attributes: ["action-cancel-edit"], classes: ["hidden"], icon: "X" })}
                            ${Buttons.create({ intent: "transparent", shape: "circle", attributes: ["action-update-comment"], classes: ["hidden"], icon: "device-floppy" })}
                        </div>

                    </div>
                </div>
            </div>

        `, "text/html").querySelector<HTMLElement>(".cdm-form");

    }

}
