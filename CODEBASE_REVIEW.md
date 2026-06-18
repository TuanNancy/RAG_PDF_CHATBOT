# Codebase Review - RAG-PDF-chatbot

## 1. Muc tieu project

Project nay la mot ung dung RAG cho PDF:

- User dang nhap bang Supabase Auth.
- User upload file PDF len backend.
- Backend extract text, chunk, embed va luu vector vao Milvus.
- User chat voi tung tai lieu da upload.
- Backend retrieve chunk lien quan va stream cau tra loi qua SSE.

Kien truc tong the la monorepo nho, tach ro:

- `backend/`: FastAPI + RAG pipeline.
- `frontend/`: Next.js App Router + Supabase client auth + UI upload/chat.
- `docker-compose.yml`: stack Milvus local.

## 2. Cau truc repo thuc te

### Root

- `README.md`: mo ta tong quan, kha day du nhung co mot so phan da cu hon code hien tai.
- `ARCHITECTURE.md`: tom tat architecture, cung co vai diem khong con trung 100% voi repo.
- `docker-compose.yml`: khoi tao `etcd`, `minio`, `milvus`, `attu`.
- `logo1.png`: asset duoc frontend doc qua route `/brand/logo`.
- `test.pdf`: file mau trong repo.

### Backend

- `backend/app/main.py`: FastAPI app, CORS, mount router `upload` va `chat`.
- `backend/app/core/`: config, auth, model catalog, user messages.
- `backend/app/routers/`: API layer.
- `backend/app/processors/`: doc PDF + chunking.
- `backend/app/providers/`: LLM provider va embeddings.
- `backend/app/storage/`: storage abstraction va Milvus implementation.
- `backend/app/ai/`: orchestration RAG.
- `backend/app/models/`: dataclass cho ket qua indexing.
- `backend/app/services/`: upload file goc len Supabase Storage qua S3 API.
- `backend/tests/`: test cho upload/chat.
- `backend/scripts/`: script test tay cho chunking va retrieval.

### Frontend

- `frontend/src/app/`: page, layout, auth pages, chat page, brand logo route.
- `frontend/src/components/`: UI components.
- `frontend/src/components/auth/`: login/signup form.
- `frontend/src/lib/`: API client, Supabase client/server, auth middleware, messages, model options, utils.
- `frontend/src/types/`: types cho upload/chat/SSE.

## 3. Backend flow chi tiet

### 3.1 Config va startup

File quan trong nhat la `backend/app/core/config.py`.

Project load env theo thu tu:

1. `/.env`
2. `/backend/.env` voi `override=True`

Mot so nhom config chinh:

- chunking: `CHUNK_SIZE`, `CHUNK_OVERLAP`
- upload: `UPLOAD_MAX_SIZE_MB`
- Milvus: host/port/collection/vector dim/index params
- OpenRouter: API key, base URL, chat model
- embeddings: model, dimension
- retrieval: `RETRIEVAL_TOP_K`, `MIN_RELEVANCE_SCORE`, `CONTEXT_MAX_CHARS`
- Supabase Auth
- Supabase Storage S3

Luu y:

- `OPENAI_API_KEY` duoc chap nhan nhu alias legacy cho `OPENROUTER_API_KEY`.
- Neu embedding model co dang `text-embedding-*` thi code tu them prefix `openai/`.

### 3.2 Auth

Auth backend khong verify JWT local. Thay vao do:

- Lay bearer token tu header `Authorization`.
- Goi `GET {SUPABASE_URL}/auth/v1/user`.
- Gui kem `apikey` la publishable key cua Supabase.
- Neu hop le thi tra ve user payload.

File thuc hien:

- `backend/app/core/auth.py`

He qua thiet ke:

- Moi request `upload` va `chat` deu phu thuoc vao Supabase Auth service online.
- Backend hien tai khong co user database rieng.

### 3.3 Upload pipeline

API:

- `POST /api/upload`
- File: `backend/app/routers/upload.py`

Flow thuc te:

1. Validate extension `.pdf`.
2. Validate content type voi allowlist rong hon `application/pdf`.
3. Doc file theo chunk 1 MB de check size.
4. Tao `doc_id` moi bang UUID.
5. Thu upload file PDF goc len Supabase Storage bang `try_upload_pdf(...)`.
6. Ghi bytes vao temp file.
7. `load_pdf_pages(...)` dung PyMuPDF to extract text page-by-page.
8. Detect PDF co kha nang la scanned neu qua nhieu page co it text.
9. `chunk_documents(...)` dung `RecursiveCharacterTextSplitter`.
10. Embed tat ca chunks qua OpenRouter embeddings.
11. Tao/connect Milvus storage.
12. `ensure_collection(vector_dim=actual_dim)`.
13. `insert_chunks(...)` vao Milvus.
14. Tra ve `IndexingResult`.

Model response:

- `doc_id`
- `name`
- `chunks_count`
- `status`
- `processing_time`
- `created_at`
- `warnings` neu co
- `pdf_storage_key` neu upload file goc thanh cong

Luu y implementation:

- Upload len Supabase Storage la best effort. Neu fail thi indexing van tiep tuc.
- `embedder.dimension` duoc probe bang API call that su, khong doan theo config.
- Neu Milvus collection co vector dim khac dim embedding hien tai, code se drop va recreate collection.

### 3.4 PDF processing

File:

- `backend/app/processors/pdf.py`

Hai ham chinh:

- `load_pdf_pages(...)`
- `chunk_documents(...)`

Dac diem:

- Metadata page/source duoc normalize.
- Chunk hien tai chi luu `text`, `page`, `source`.
- Chua co OCR. PDF scan chi duoc canh bao, khong duoc xu ly them.

### 3.5 Embeddings va LLM

Files:

- `backend/app/providers/embeddings.py`
- `backend/app/providers/openrouter.py`
- `backend/app/providers/base.py`
- `backend/app/providers/factory.py`

Thiet ke:

- Provider pattern, nhung hien tai chi co 1 provider: OpenRouter.
- Embeddings dung OpenAI-compatible API cua OpenRouter.
- Chat completions cung qua OpenRouter, co support streaming.

Chi tiet can nho:

- Embeddings client la synchronous OpenAI client.
- Chat provider la `AsyncOpenAI`.
- `get_embedder()` duoc cache bang `lru_cache`.

### 3.6 Storage va retrieval

Files:

- `backend/app/storage/base.py`
- `backend/app/storage/milvus_storage.py`
- `backend/app/storage/factory.py`

Thiet ke:

- Strategy + Factory pattern.
- Hien tai backend chi support `milvus`.

Schema Milvus gom:

- `id`
- `doc_id`
- `text`
- `embedding`
- `page`
- `source`
- `created_at`
- `updated_at`
- `status`
- `metadata`

Retrieval:

- Query duoc embed.
- Search Milvus theo `doc_id`.
- Dung `top_k` va `min_score`.
- Score la distance/similarity do Milvus tra ve.

### 3.7 RAG orchestration

File:

- `backend/app/ai/rag_agent.py`

Vai tro:

- Khoi tao provider + storage.
- Embed query.
- Retrieve chunks.
- Loai text trung/gan trung.
- Build context bi gioi han boi `context_max_chars`.
- Goi provider stream response.

Luu y:

- Context builder hien khong dua page/score vao body prompt, ma chi tao `[Excerpt N]`.
- Chat prompt lay theo ngon ngu tu `app.ai.prompts`.
- Neu khong tim thay chunk, backend tra fallback message thay vi goi model.

### 3.8 Chat API va SSE

API:

- `POST /api/chat`
- File: `backend/app/routers/chat.py`

Input:

- `query`
- `doc_id`
- `language`
- `model` optional

Flow:

1. Validate request.
2. Validate `model` thuoc allowlist trong `core/model_catalog.py`.
3. Tao `RAGAgent`.
4. Retrieve chunks truoc.
5. Stream ngay event `sources`.
6. Neu khong co source thi stream fallback `token` + `done`.
7. Neu co source thi stream token LLM.
8. Ket thuc bang `done`.

Event types:

- `sources`
- `token`
- `error`
- `done`

## 4. Frontend flow chi tiet

### 4.1 Kien truc chung

Frontend dung Next.js 14 App Router, React client components cho phan chat/auth.

File trung tam:

- `frontend/src/app/chat/page.tsx`

Page nay gom gan nhu toan bo app state phia client:

- user/session
- access token
- danh sach document trong session
- active document
- selected model
- sidebar/profile UI state

### 4.2 Auth flow

Auth duoc xu ly ca middleware, server action va client Supabase SDK.

Files:

- `frontend/src/lib/client.ts`
- `frontend/src/lib/server.ts`
- `frontend/src/lib/middleware.ts`
- `frontend/src/app/auth/actions.ts`
- `frontend/src/components/auth/LoginForms.tsx`
- `frontend/src/components/auth/SignupForm.tsx`

Flow:

- Middleware redirect:
  - chua login vao `/chat` se bi day sang `/auth/login`
  - da login vao `/auth/*` hoac `/` se bi day sang `/chat`
- Login email/password dung server action.
- Login Google dung client-side OAuth.
- Session duoc doc lai tren client qua `supabase.auth.getUser()` va `getSession()`.

### 4.3 Upload flow tren UI

File:

- `frontend/src/components/UploadZone.tsx`
- `frontend/src/lib/api.ts`

Flow:

1. User drop/chon file.
2. Client validate file co phai PDF.
3. Neu khong co `NEXT_PUBLIC_API_URL` thi chay mock mode.
4. Neu co backend:
   - gui `multipart/form-data` den `/api/upload`
   - kem bearer token Supabase
5. Ket qua duoc day len `ChatPage` qua `onUploadComplete`.
6. `ChatPage` them document vao state va localStorage.

Luu y:

- Danh sach document duoc luu trong localStorage:
  - `baymax_uploaded_documents`
  - `baymax_active_document`
- Day chi la session-level client persistence, khong phai document catalog that su tu backend.

### 4.4 Chat flow tren UI

File:

- `frontend/src/components/ChatWindow.tsx`
- `frontend/src/lib/api.ts`

Flow:

1. User nhap cau hoi.
2. UI them message cua user.
3. Tao message assistant dang stream.
4. Goi `streamChat(...)`.
5. Parse SSE bang `streamChatSSEParser(...)`.
6. Event `token` duoc append vao message assistant.
7. Event `done` ket thuc stream.

Luu y quan trong:

- Frontend dang bo qua event `sources`.
- Mac du repo co `SourceCard.tsx` va `SourceCardList.tsx`, hien tai `ChatWindow` khong render sources.
- Nghia la backend da stream citation, nhung UI chua noi day du.

### 4.5 Model switcher

Files:

- `frontend/src/lib/modelOptions.ts`
- `backend/app/core/model_catalog.py`

Frontend va backend deu co allowlist model rieng, nhung dang dong bo ve 3 model:

- `google/gemini-2.0-flash-lite-001`
- `openai/gpt-4o-mini`
- `anthropic/claude-3.5-haiku`

Chat page luu model dang chon vao localStorage bang key `baymax_selected_model`.

### 4.6 Mock mode

Neu `NEXT_PUBLIC_API_URL` khong duoc set:

- Upload se mo phong thanh cong.
- Chat se mo phong stream text.
- Footer hien "che do demo".

Dieu nay giup dev giao dien ma chua can backend.

## 5. Testing va muc do bao phu

Backend co test voi `pytest`.

Files:

- `backend/tests/conftest.py`
- `backend/tests/test_upload.py`
- `backend/tests/test_chat.py`

Phan dang duoc cover:

- upload validation
- upload success voi mocked pipeline
- chat validation co ban
- chat SSE stream mock

Phan chua thay test sau:

- retrieval that voi Milvus
- embeddings/OpenRouter integration
- auth call that voi Supabase
- frontend components
- end-to-end flow upload -> retrieve -> chat

## 6. Nhan xet sau khi review

### Diem manh

- Tach lop backend kha ro: router / processor / provider / storage / ai.
- RAG flow de theo doi, khong qua nhieu abstraction thua.
- SSE chat duoc thiet ke gon, de tich hop UI.
- Co mock mode o frontend nen de phat trien giao dien song song.
- Upload original PDF len storage la optional, khong chan indexing.

### Gioi han hien tai

- Chi support single-document chat moi request.
- Khong co lich su hoi thoai tren backend.
- Khong co endpoint list/delete document that su theo user.
- Remove document tren sidebar chi xoa khoi state client, khong xoa vector trong Milvus hay file trong storage.
- Chua co OCR cho scanned PDF.
- Frontend chua render sources du backend stream ra.

### Do lech giua docs va code

Sau khi doi chieu, co mot so diem can luu y:

- `README.md` va `ARCHITECTURE.md` mo ta mot vai file khong thay trong repo hien tai hoac da doi:
  - vi du `frontend/src/lib/*` co ton tai that, nhung `rg --files` ban dau cho thay docs va code da khong hoan toan dong bo
  - `ARCHITECTURE.md` nhac `app/models/agent.py`, nhung repo hien tai khong co file nay
- Docs mo ta source citation card, va frontend cung co component cho no, nhung flow UI thuc te chua su dung.

Noi chung docs van huu ich de onboarding, nhung de phuc vu phat trien tiep thi nen cap nhat lai theo implementation hien tai.

## 7. Ket luan

Day la mot MVP RAG PDF chatbot co nen tang kha tot:

- backend gon, de mo rong
- frontend da co auth, upload, chat, model switcher
- infrastructure local cho Milvus da san sang

Neu tiep tuc phat trien, cac huong hop ly nhat se la:

1. Bo sung document management theo user o backend.
2. Noi event `sources` vao UI.
3. Them OCR pipeline cho scanned PDF.
4. Them end-to-end test va integration test.
5. Dong bo lai docs voi codebase thuc te.
