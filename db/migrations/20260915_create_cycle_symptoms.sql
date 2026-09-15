-- Mini App: Цикл - отметки самочувствия по дням: симптомы, выделения, свой текст.
-- Одна строка на день. Коды латиницей, русские подписи живут только в приложении.
--
-- Доступ: читает и пишет только cycles-api под service_role, со скоупом по sub из
-- токена. RLS включён БЕЗ политик, гранты у anon и authenticated отозваны: в этой
-- базе дефолтные привилегии выдают им полные права на каждую новую таблицу, и
-- одного RLS мало. Копировать политику таблицы cycles сюда нельзя: она открывает
-- путь любому JWT с подходящим sub, а читать эту таблицу больше некому.
--
-- Удаление настоящее, не мягкое: медицинские данные. Пустой день cycles-api
-- удаляет строкой DELETE, пустая строка в таблице не живёт (проверка not_empty).
--
-- Список допустимых кодов проверяет cycles-api, а не база: формулировки утверждает
-- Ирена, и правка списка не должна требовать миграции. База держит только то, что
-- от списка не зависит: взаимоисключения, пустоту, длину текста, мусор в массивах.
-- Эти проверки последний рубеж. cycles-api обязан отсекать то же самое ДО записи:
-- сработавшая проверка пишет в логи Postgres строку целиком, то есть симптомы.
--
-- updated_at ставит cycles-api при каждой записи. Общей триггер-функции в базе
-- нет, заводить её в общей с biohack схеме ради одного писателя не стали.
--
-- Применено на боевой (kjzxrpwqyyjcykwbqskn) 2026-09-15 через прямой DDL.

begin;

create table public.cycle_symptoms (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null,
  date        date not null,
  symptoms    text[] not null default '{}',
  discharge   text[] not null default '{}',
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint cycle_symptoms_user_date_unique unique (user_id, date),

  -- "Все в порядке" и "Выделений нет" это отметки, а не пустота, и с другими
  -- значениями своего списка не совмещаются.
  constraint cycle_symptoms_fine_exclusive
    check (not ('fine' = any (symptoms) and cardinality(symptoms) > 1)),
  constraint cycle_symptoms_none_exclusive
    check (not ('none' = any (discharge) and cardinality(discharge) > 1)),

  -- Без null внутри массивов: иначе проверка выше на таком массиве даёт null и молча пропускает.
  constraint cycle_symptoms_no_null_codes
    check (array_position(symptoms, null) is null and array_position(discharge, null) is null),

  -- Защита от мусора, а не от длины списка: в списке 17 и 9, запас на правки Ирены.
  constraint cycle_symptoms_codes_bounded
    check (cardinality(symptoms) <= 30 and cardinality(discharge) <= 30),

  -- Пустой текст хранится как null, длина до 300 знаков.
  constraint cycle_symptoms_note_len
    check (note is null or char_length(note) between 1 and 300),

  -- Пустой день не хранится, его удаляют.
  constraint cycle_symptoms_not_empty
    check (cardinality(symptoms) > 0 or cardinality(discharge) > 0 or note is not null),

  constraint cycle_symptoms_date_sane
    check (date >= date '2020-01-01')
);

comment on table public.cycle_symptoms is
  'Цикл: самочувствие по дням. Только через cycles-api (service_role). RLS без политик, гранты anon/authenticated отозваны.';

alter table public.cycle_symptoms enable row level security;

revoke all on table public.cycle_symptoms from anon, authenticated;

commit;

-- PostgREST должен увидеть новую таблицу, иначе cycles-api получит 404 на этапе 2.
notify pgrst, 'reload schema';
