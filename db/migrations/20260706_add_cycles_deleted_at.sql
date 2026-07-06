-- Mini App: Цикл - soft-delete отметок цикла.
-- Добавляет колонку deleted_at. Purely additive, безопасно для shared-проекта
-- (в той же БД живут таблицы biohack / 870 подписчиков).
--
-- Решение по UNIQUE cycles_user_date_unique (user_id, start_date):
-- оставляем плоский UNIQUE как есть, БЕЗ частичного индекса. Повторный ввод даты
-- после soft-delete решается РЕАНИМАЦИЕЙ: create в cycles-api это upsert с
-- on_conflict=user_id,start_date + resolution=merge-duplicates, и в тело добавлен
-- deleted_at:null, поэтому конфликт по дате обновляет старую строку и сбрасывает
-- deleted_at обратно в null. Мёртвые строки не плодятся, второй путь записи не нужен.
--
-- Применено на боевой (kjzxrpwqyyjcykwbqskn) 2026-07-06 через прямой DDL.

alter table public.cycles add column if not exists deleted_at timestamptz;
