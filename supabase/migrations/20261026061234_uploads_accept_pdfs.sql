-- PDFs join PowerPoint decks as uploads (CLAUDE.md, Scope).
--
-- The bucket checks the type the browser declares, which the upload form sets to the type the
-- server accepted the file as; the worker still checks that the file really is one. An upload's
-- object key now ends in its type, which is how the worker knows how to read it:
--   uploads/{user_id}/{document_id}.pptx
--   uploads/{user_id}/{document_id}.pdf
-- `create_question` already cites a page by its document's type: "lecture.pptx, slide 3" for a
-- deck and "notes.pdf, page 3" for anything else.

update storage.buckets
   set allowed_mime_types = array[
     'application/vnd.openxmlformats-officedocument.presentationml.presentation',
     'application/pdf'
   ]
 where id = 'uploads';
