# Glint — страница в Chrome Web Store

Готовые тексты для формы публикации (Developer Dashboard). Скриншоты: `npm run store` → `tools/out/store/{ru,en}/`, 5 кадров 1280×800. Архив: `npm run pack` → `dist/glint-<версия>.zip`.

## Вкладка «Store listing»

**Name** — берётся из манифеста (`extName`):
- en: Glint — Auto Points for Twitch
- ru: Glint — автосбор баллов для Twitch

Не ставить «Twitch» первым словом и не убирать «for/для Twitch»: правила бренда Twitch разрешают только указание совместимости, а магазин отклоняет названия, похожие на официальные.

**Summary** — тоже из манифеста (`extDescription`, до 132 символов).

**Category:** Entertainment (Развлечения).

**Language:** English (основной), плюс Russian.

### Detailed description — English

Glint collects your Twitch channel points for you, claims moments and drops, and shows how much you've earned.

What it does
• Channel points: clicks the bonus chest as soon as it appears.
• Moments: claims moment badges during streams.
• Drops: while a stream is open, checks your drops inventory every 15–60 minutes in an invisible frame (no new tabs) and claims what's ready.
• Player: keeps the stream playing in background tabs, presses "retry" after player errors, skips the mature content warning.
• Channels: collect everywhere, only on chosen channels, or everywhere except them.
• Statistics: points today and all time, a 7/14/30-day chart, every channel with search and sorting, a full history of what was collected.
• Self-check: if Twitch changes its site and buttons stop working, Glint tells you instead of failing silently.
• Every automatic feature has its own switch.

Privacy
Glint has no servers of its own, no analytics and no ads. Your settings and statistics stay in your browser; you can download them as JSON and load them back. The only thing loaded from the network is channel avatar pictures from Twitch's own image server, and you can turn that off.

Languages: English and Russian. Light and dark theme follow your system.

Glint is not affiliated with or endorsed by Twitch. Automating actions may be against Twitch's rules; use it at your own discretion.

### Подробное описание — русский

Glint сам собирает бонусные баллы каналов на Twitch, забирает моменты и дропы и показывает, сколько вы заработали.

Что умеет
• Баллы канала: нажимает на сундук с бонусом, как только он появляется.
• Моменты: забирает памятные моменты во время стрима.
• Дропы: пока открыт стрим, раз в 15–60 минут проверяет инвентарь дропов в невидимом фрейме (без новых вкладок) и забирает готовые.
• Плеер: стрим не встаёт на паузу в фоновой вкладке, после ошибки плеера нажимается «Повторить», предупреждение 18+ пропускается.
• Каналы: собирать везде, только на выбранных каналах или везде, кроме них.
• Статистика: баллы за сегодня и за всё время, график за 7, 14 или 30 дней, все каналы с поиском и сортировкой, полная история собранного.
• Самопроверка: если Twitch изменит сайт и кнопки перестанут нажиматься, Glint сообщит об этом, а не будет молча бездействовать.
• Каждую автоматическую функцию можно выключить.

Приватность
У Glint нет своих серверов, аналитики и рекламы. Настройки и статистика хранятся только в вашем браузере; их можно скачать в JSON и загрузить обратно. Из сети загружаются только картинки аватаров каналов с сервера самого Twitch, и это можно выключить.

Языки: русский и английский. Светлая и тёмная тема подстраиваются под систему.

Glint не связан с Twitch и не одобрен Twitch. Автоматизация действий может противоречить правилам Twitch, пользуйтесь на своё усмотрение.

## Вкладка «Privacy practices»

**Single purpose:**
Glint automates claiming Twitch channel rewards (channel points bonus, moments and drops) on twitch.tv and shows statistics of what was claimed.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `storage` | Stores the user's settings and the statistics of claimed points, moments and drops locally in the browser. Nothing is sent anywhere. |
| `alarms` | Schedules the periodic drops inventory check (every 15–60 minutes) and the midnight reset of the "points today" badge. |
| `notifications` | Optional system notifications when a drop or a moment is claimed; both can be turned off in settings. |
| Host `https://www.twitch.tv/*` | Content scripts run only on twitch.tv to find and click the channel points bonus, moment and drop claim buttons, keep the player running in background tabs and read channel names for statistics. The script also runs in frames (`all_frames`) so that the drops inventory can be checked inside an invisible same-origin frame instead of opening a new tab. |

**Are you using remote code?** No. All code is in the package. The popup only loads channel avatar images (not code) from `https://static-cdn.jtvnw.net`, Twitch's image server; this can be turned off.

**Data usage:** no user data is collected or transmitted. Не отмечать ни одного типа данных и поставить все три подтверждения (не продаём данные, не используем их не по назначению, не используем для кредитоспособности).

**Privacy policy URL:** https://github.com/Tekutorukushi/glint/blob/main/PRIVACY.md — основной репозиторий, должен быть публичным, чтобы ссылка открывалась без входа.

## Перед отправкой

- [ ] `npm test` — все проверки проходят.
- [ ] Версия в `manifest.json` выше, чем у прошлой загруженной.
- [ ] `npm run pack` — в архиве только `manifest.json`, `_locales`, `icons/*.png`, `src`.
- [ ] `npm run store` — свежие скриншоты (по 5 на язык).
- [x] Политика опубликована: https://github.com/Tekutorukushi/glint/blob/main/PRIVACY.md
- [ ] Актуальный `PRIVACY.md` отправлен на GitHub (`git push`), ссылка открывается в окне инкогнито.
- [ ] Последние коммиты отправлены на GitHub (`git push`).
- [ ] Проверено на настоящем Twitch: сундук, моменты, дропы, аватары.
