-- Tables join as an asset kind and a question type (CLAUDE.md, Data model): the worker reads the
-- tables in a deck or PDF, and generation blanks some of their cells for the student to fill in.
--
-- On their own because Postgres refuses a new enum value inside the transaction that added it,
-- and the next migration's function and constraint use both.

alter type public.asset_kind add value 'table';
-- Right after diagrams: studying orders questions by type, and tables are the hero feature too.
alter type public.question_type add value 'table_blank' after 'diagram_blank';
