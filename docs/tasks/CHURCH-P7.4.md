# P7.4-plan-r1 — OCR sổ Báp-têm local

Hồ sơ lịch sử thử nghiệm local. Mã thử nghiệm OCR và bằng chứng trong `output/` thuộc checkout thử nghiệm. Xem [quyết định hoãn](#quyết-định-hoãn-p74).

Khiêm duyệt P7.4-plan-r1, bộ 32 trang, chất lượng, PaddleOCR local, dữ liệu tạm 24 giờ và ASCII. Chỉ triển khai local/synthetic. Bàn giao 74-01–74-03 rồi dừng trước P7.5. [Roadmap C74](CHURCH-P7.md#p74--ocr-sổ-báp-têm-viết-tay).

## Kế hoạch đã duyệt

- **74-01.** 32 trang chữ viết tay synthetic, 8 dòng/trang. 12 trang phát triển, 16 trang nghiệm thu (8 rõ, 8 khó vừa), 4 trang lỗi. Tách nhóm nét bút và trang gốc khỏi tập phát triển. Bảng 4 cột Họ tên/Ngày/Nơi/Người cử hành, có hoặc không có STT. Chấm trước sửa tay. Ngưỡng tách dòng ≥95%, họ tên ≥85%, ngày đầy đủ ≥90%, nơi và người cử hành mỗi trường ≥75%. Phản hồi xử lý cho 4/4 trang lỗi. Không bỏ dấu khi so văn bản. Đo khởi động lạnh, p95 ấm ≤15 giây/trang, timeout 30 giây/tác vụ.
- **74-02.** Thư ký có quyền quản lý lễ nghi chọn trang, OCR, so từng dòng với ảnh, chọn hồ sơ đúng tenant. Ngày mơ hồ có thể xác nhận chưa rõ. Hiển thị bản đã ghi hoặc facts hiện hành để đối chiếu. Mỗi lần dùng preview và xác nhận của Rites. Chỉ ghi khi Thư ký xác nhận, tránh tự gắn hồ sơ và tránh lễ trùng.
- **74-03.** JPEG/PNG ≤5 MiB và 20 MP. Một OCR đồng thời, CPU local bị chặn mạng. Mongo giữ ảnh và kết quả theo actor/tenant tối đa 24 giờ. Kiểm hết hạn, đầu vào, timeout, quyền, nguồn đổi, cạnh tranh và hồi quy sau mất phản hồi. Dọn dữ liệu tạm và không dùng ảnh thật.
- So sánh v6 small và v5 mobile + Latin trên tập phát triển. Chỉ model đã chọn chạy tập nghiệm thu. Nếu không đạt, báo FAIL theo trường và nhóm ảnh. Đo chất lượng OCR tách evidence UI/contract.

```text
W06 > Báp-têm > [Nhập từ ảnh sổ cũ]
[Chọn ảnh] [Đọc ảnh]           Dòng 2/8 · Cần kiểm tra
[Ảnh trang sổ]                 Hồ sơ [Tìm và chọn]
[Phóng ảnh]                    Ngày [Chưa rõ]
                               Nơi / Người cử hành
                               [Bỏ qua dòng] [Xem trước]
Xem trước > Hồ sơ · Ngày · Nơi · Người cử hành
                          [Quay lại] [Xác nhận ghi nhận]
```

## Phương án triển khai

Rites quản lý phiên đối soát và dùng lại quyền preview/ghi Báp-têm hiện hành. Bun gọi PaddleOCR qua Python local. Phiên OCR chứa ảnh đã chuẩn hóa và kết quả thô, khóa theo tenant và người tải, không gắn hồ sơ từ tên đoán. Ledger Rites và dấu đã ghi của dòng được ghi trong cùng giao dịch. Thời hạn giữ ảnh, quyền và ràng buộc duy nhất của bản Báp-têm áp tại backend.

### Chạy lại local

- Python 3.13 ARM64. Môi trường thực đo dùng PaddleOCR 3.7.0, PaddlePaddle 3.3.1 và PaddleX 3.7.2. [Danh sách gói thực tế](../../output/p7.4/runtime-freeze.txt). Dùng artifact chính thức từ [tài liệu PaddleOCR](https://www.paddleocr.ai/main/en/version3.x/pipeline_usage/OCR.html), đối chiếu [SHA-256 model](../../tools/baptism-ocr/model-lock.json). Chuẩn bị model trước, truyền thư mục cục bộ vào worker. Worker kiểm checksum model, chạy bằng `sandbox-exec` chặn mạng trên macOS local. Ảnh xử lý qua stdin và bộ nhớ, kết quả JSON qua stdout.
- Biến `CHURCH_P74_PYTHON` và `CHURCH_P74_MODELS` cấu hình bản chạy synthetic. Có thể chọn `CHURCH_P74_MODEL_FAMILY=v5` để đối chiếu. Cấu hình thí nghiệm mặc định v6 khi đã chỉ rõ runtime và thư mục model. Database thử có collection/index TTL mới. Chạy fixture local tách biệt, không kích hoạt trên main.
- `fixtures.py` tạo bộ 32 trang từ sáu phông nét viết tay, bằng nội dung hư cấu do seed cố định. Hai tập có phông tách biệt. Đây là chữ viết tay mô phỏng bằng phông. [Manifest ảnh và nhãn](../../output/p7.4/fixtures/manifest.json). `benchmark.py` đo thô từng trường, nhóm ảnh và thời gian. Báo cáo benchmark lưu trong `output/p7.4`.

Từ gốc repo, dùng bộ model và phông đã chuẩn bị trong `.local` để tạo lại ảnh và đo trên thư mục kết quả mới. Trường `passed` trong báo cáo cho biết kết quả so với ngưỡng.

```sh
.local/p74-ocr/bin/python tools/baptism-ocr/fixtures.py .local/p74-fonts output/p7.4/replay
/usr/bin/sandbox-exec -p '(version 1) (allow default) (deny network*)' \
  .local/p74-ocr/bin/python tools/baptism-ocr/benchmark.py \
  .local/p74-models output/p7.4/replay output/p7.4/replay/eval-v6.json --split eval --family v6
```

## Bàn giao P7.4-r1

| Mục | Kết quả local/synthetic | Bằng chứng |
| --- | --- | --- |
| 74-01 | **FAIL**. Tách dòng 128/128, ngày đầy đủ 111/111, họ tên 2/128 (1,6%), nơi 32/118 (27,1%), người cử hành 8/115 (7,0%). | [Tập phát triển v5](../../output/p7.4/dev-v5.json), [v6](../../output/p7.4/dev-v6.json) và [lượt nghiệm thu đầu](../../output/p7.4/eval-v6.json). Chấm chính xác trên các ô có nhãn hợp lệ và giữ dấu tiếng Việt. |
| 74-02 | **PASS kỹ thuật**. Chọn hồ sơ bằng tay, xác nhận ngày chưa rõ, cảnh báo lễ trùng và chỉ ghi dòng đã xác nhận. | Tích hợp Rites và [Firefox W06](../../output/p7.4/browser-r3/browser-results.json). Firefox dùng kết quả OCR synthetic cố định để kiểm hành vi. Tích hợp chạy thêm một ảnh synthetic qua PaddleOCR thật và HTTP handler. |
| 74-03 | **PASS kỹ thuật trong phạm vi local**. Kiểm mất quyền, phạm vi người tải/Hội Thánh, định dạng, timeout, nguồn đổi sau preview, ghi đồng thời, gửi lại sau mất phản hồi và dọn TTL. | [Tích hợp MongoDB/Redis](../../output/p7.4/integration.log) và [dọn database Firefox](../../output/p7.4/browser-r3/browser-cleanup.json). API chặn truy cập từ mốc 24 giờ. MongoDB xóa vật lý trong lượt quét TTL kế tiếp. |

Lượt nghiệm thu đầu xử lý đúng 3/4 trang lỗi. Sau khi bổ sung kiểm tra tiêu đề cột, [lượt hồi quy](../../output/p7.4/eval-v6-layout-r2.json) đạt 4/4 trang lỗi, p95 ấm 3,25 giây/trang và lần đầu 2,17 giây. Điểm các trường giữ nguyên. Các phông mô phỏng và cấu trúc bảng trong bộ 32 trang giới hạn khả năng suy rộng kết quả.

28 bài tích hợp, 533 assertions. Firefox 1.032 checks, 56 ảnh, 140 lượt đo khoảng cách. `git diff --check`, `bun run typecheck`, `bun run ui:check` và build Vite trong browser runner đạt. `bun run lint` qua với 10 cảnh báo CSS dùng chung đã có. [Tổng hợp evidence](../../output/p7.4/verification.json).

Tại thời điểm bàn giao, P7.4 chưa đạt đủ cổng nghiệm thu vì 74-01. Thiết bị thật, Safari, chữ viết tay thật, full suite, UAT, main runtime, pilot, remote CI và production NOT_RUN.

### Nghiệm thu riêng sau bàn giao

Khiêm nghiệm thu **74-02** và **74-03** của P7.4-r1 ở phạm vi local/synthetic. **74-01** còn mở với kết quả FAIL đã ghi. Khiêm yêu cầu trình kế hoạch bổ sung cho OCR local trên tập nghiệm thu độc lập trước coding. P7.5 chưa mở. [Biên bản nghiệm thu riêng](../engineering/skill-usage/records/CHURCH-P7/P7.4-partial-acceptance-1.json).

## P7.4-plan-r2 — kế hoạch bổ sung 74-01 đã duyệt

Khiêm duyệt bộ nghiệm thu độc lập 28 trang hỗn hợp và triển khai local/synthetic. Khiêm chốt nguồn người viết phiếu hư cấu trước khi đo. Bàn giao 74-01 để Khiêm nghiệm thu rồi dừng trước P7.5.

1. **74-01.1 · Chọn model.** Giữ tách bảng hiện tại và đối chiếu v6 small của r1. Kiểm bộ ký tự tiếng Việt, nguồn trọng số, SHA-256 và chạy CPU ARM64 offline. Đo cả ảnh cắt ô và trang đầy đủ. Ưu tiên trọng số tương thích sẵn có. Nếu không đạt trên tập phát triển, thực hiện một vòng huấn luyện bộ đọc ô nhẹ với Paddle và dữ liệu hư cấu riêng. Không tra hồ sơ, không suy đoán dấu từ danh sách tên. Nếu vòng phát triển không đạt thì bàn giao điểm và giữ tập nghiệm thu chưa mở.
2. **74-01.2 · Tập độc lập.** 24 trang chấm điểm, 8 dòng/trang. 12 trang phông mới và 12 trang viết tay từ phiếu hư cấu, tối thiểu bốn người viết chưa có trong tập phát triển. Mỗi nhóm sáu trang rõ và sáu trang khó vừa. Có/không STT, tên gần giống khác dấu, định dạng ngày đã hỗ trợ, ô trống, ngày chưa rõ. Bốn trang lỗi gồm ảnh mờ không đọc được, bố cục ngoài phạm vi, mất tiêu đề và không có bảng. Tách phông/người viết, nội dung phiếu và trang gốc khỏi phát triển. Tập 32 trang r1 dùng cho hồi quy. Khóa model, cấu hình, cách chấm, ảnh và nhãn bằng checksum trước khi đo. Nếu chọn sửa model sau khi xem điểm nghiệm thu, dùng tập độc lập mới cho lần đo tiếp theo.
3. **74-01.3 · Kiểm đường chạy thật.** Dùng đúng model đã chấm qua worker offline, API Rites, W06 theo ASCII r1. Hồi quy quyền Thư ký, xác nhận từng dòng, chống ghi trùng, gửi lại, timeout 30 giây và TTL 24 giờ. Bàn giao manifest, checksum, lệnh tái lập và kết quả đọc thô. Không mở lại nghiệm thu 74-02/03.

Ngưỡng giữ theo r1: dòng ≥95%, họ tên ≥85%, ngày đầy đủ ≥90%, nơi và người cử hành mỗi trường ≥75%, xử lý 4/4 trang lỗi, p95 ấm ≤15 giây/trang. Báo thêm cold start. Chấm trước sửa tay, giữ dấu với NFC/hoa thường/khoảng trắng theo r1, ô thiếu khi nhãn có giá trị tính bỏ sót. Báo số đúng/sai/bỏ sót, dòng thừa, ô trống có giá trị gợi ý và dòng cần đối soát theo nhóm ảnh. Chỉ khi đạt đủ ngưỡng và hồi quy đường chạy thật mới bàn giao 74-01 đạt kỹ thuật.

### Chuẩn bị mẫu viết tay độc lập

- Dùng 12 phiếu trống và bảng nội dung hư cấu do `holdout.py prepare` sinh sau khi khóa model. Mỗi người dùng mã giả như `writer-01`. Chia đủ 12 phiếu cho tối thiểu bốn người chưa cung cấp ảnh phát triển. Dùng nội dung phiếu và giữ ô được chỉ định trống. Không điền tên người viết, tên Hội Thánh hoặc thông tin từ sổ thật.
- Sáu phiếu nhóm rõ chụp thẳng, đủ sáng. Sáu phiếu nhóm khó vừa có thể hơi nghiêng, mờ nhẹ hoặc bóng nhẹ, vẫn đọc được và giữ đủ bảng. Ảnh JPG/PNG tối đa 5 MiB và 20 MP. Giữ bản ảnh và nhãn trong thư mục local không theo dõi bởi Git. Người chuẩn bị đối chiếu lại với chữ nhìn thấy, kể cả khi người viết chép nhầm.
- `holdout.py seal` nhận JSON có khóa là tên ảnh, mỗi giá trị gồm `writer` và tám `rows`. Mỗi dòng gồm `fields` theo thứ tự họ tên, ngày, nơi, người cử hành và `y` là tung độ tâm dòng tại giữa bảng chia cho chiều cao ảnh gốc. Script kiểm đủ trang, nhóm, mã người viết, nhãn và SHA-256. Người giữ tập gửi checksum manifest cùng bộ ảnh sau khi model đã khóa, giữ các tên người viết thật ngoài manifest.
- Thư mục phông nghiệm thu chứa tối thiểu ba phông tiếng Việt OFL mới. Script từ chối SHA-256 trùng với phông huấn luyện, validation hoặc r1. Lệnh chuẩn bị không chạy suy luận. Lệnh chấm độc lập yêu cầu cả checksum manifest và bản khóa model/phần chấm tương ứng.

### Lệnh tái lập r2

Dùng thư mục `.local/p74-r2-models` chứa ba thư mục inference đã khóa. Bản đọc cột giữ model PaddleOCR v6 small cho phát hiện, tiêu đề và cột ngày. Ba cột văn bản dùng bộ đọc ô tiếng Việt với đầu ra CTC. Chỉ cấu hình `CHURCH_P74_MODEL_FAMILY=vi` cho tiến trình synthetic với `CHURCH_P74_MODELS` trỏ vào thư mục này. Lệnh huấn luyện lại dùng thư mục replay riêng để giữ trọng số đã đo.

```sh
PYTHONDONTWRITEBYTECODE=1 OMP_NUM_THREADS=1 .local/p74-ocr/bin/python \
  tools/baptism-ocr/train_vietnamese.py \
  .local/p74-r2-train-fonts .local/p74-r2-dev-fonts .local/p74-r2-replay/p74_vi_rec_infer

/usr/bin/sandbox-exec -p '(version 1) (allow default) (deny network*)' \
  .local/p74-ocr/bin/python tools/baptism-ocr/qualify.py dev \
  .local/p74-r2-models output/p7.4/fixtures output/p7.4-r2/dev-vi.json

.local/p74-ocr/bin/python tools/baptism-ocr/qualify.py freeze \
  .local/p74-r2-models output/p7.4/fixtures output/p7.4-r2/freeze.json \
  --development output/p7.4-r2/dev-vi.json
```

Sau khi có báo cáo phát triển đạt, người giữ tập dùng `holdout.py prepare` với thư mục phông giữ riêng, biên bản `training.json`, manifest r1, bản khóa và thư mục đầu ra mới. Sau khi chụp và kiểm nhãn viết tay, chạy `holdout.py seal <thư mục đầu ra> <captured.json>`. Chạy `qualify.py independent <model> <thư mục đầu ra> <báo cáo> --freeze <bản khóa> --seal <SHA-256 manifest>` dưới sandbox offline tương tự lệnh đo phát triển.

### Nguồn model phát triển r2

Model v6 tiếng Việt của bên thứ ba đã xem có bộ ký tự NFC nhưng model card thiếu thông tin giấy phép. Bản v5 tiếng Việt đã xem chỉ cấp CC BY-NC và tác giả ghi giới hạn chữ viết tay. Chọn nhánh huấn luyện local từ chữ hư cấu và phông OFL, giữ PaddleOCR v6 đã khóa cho bộ phát hiện, tiêu đề và ngày. [Model card v6](https://huggingface.co/tieubaoca/pp-ocrv6-medium-rec-vietnamese) · [Model card v5](https://huggingface.co/meomeo163/PP-OCRv5-vi-latin-rec-v4).

Vòng huấn luyện hợp lệ dùng 9.216 ô hư cấu, 22 epoch. Chọn checkpoint epoch 16 theo 130/384 ô exact trên validation tạo riêng bằng ba phông phát triển. Không dùng trang viết tay từ người viết mẫu. [Biên bản huấn luyện](../../output/p7.4-r2/training.json) · [Nguồn phông huấn luyện](../../output/p7.4-r2/training-font-sources.json) · [SHA-256 inference](../../tools/baptism-ocr/model-lock.json).

### Bàn giao phát triển P7.4-r2

| Chỉ tiêu trên 12 trang phát triển | v6 small r1 | Bộ đọc ô tiếng Việt r2 | Ngưỡng |
| --- | ---: | ---: | ---: |
| Tách dòng | 96/96 | 96/96 | ≥95% |
| Họ tên | 7/96 | 0/96 | ≥85% |
| Ngày đầy đủ | 87/87 | 87/87 | ≥90% |
| Nơi | 22/87 | 34/87 (39,1%) | ≥75% |
| Người cử hành | 4/87 | 0/87 | ≥75% |

R2 dùng chung cột ngày v6, p95 ấm 1,73 giây/trang và lần đọc đầu gồm tải model 2,76 giây. Điểm trên ô cắt riêng khớp với điểm ba trường văn bản khi đọc trang đầy đủ. Kiểm phân loại lỗi cho thấy 94/96 họ tên có thay đổi ký tự ngoài dấu. Model đã có bộ ký tự tiếng Việt nhưng nhận dạng nét và chuỗi vẫn thấp. [Báo cáo phát triển](../../output/p7.4-r2/dev-vi.json) · [Phân loại lỗi](../../output/p7.4-r2/development-error-diagnostics.json).

Hồi quy trên 16 trang chấm r1 đạt 128/128 dòng và 111/111 ngày. Họ tên 1/128, nơi 54/118, người cử hành 1/115. Xử lý đúng 4/4 trang lỗi của r1. 7 bài kiểm Python, 18 bài tích hợp Rites và 1 smoke test API với model thật qua sandbox đều qua. Typecheck, UI check và `git diff --check` qua, lint có 10 cảnh báo CSS dùng chung đã có. Smoke test chỉ kiểm kết nối model và cấu trúc phản hồi, chưa chạy nghiệm thu W06 của r2. [Hồi quy r1](../../output/p7.4-r2/regression-r1.json) · [Bằng chứng tổng hợp](../../output/p7.4-r2/verification.json).

**74-01 còn mở.** Cổng phát triển từ chối xuất bản khóa nghiệm thu. Không tạo, mở hoặc đo tập 28 trang độc lập. Nguồn viết tay độc lập chưa được dùng. 74-02 và 74-03 đã nghiệm thu riêng theo r1. P7.5 chưa mở.

## Quyết định hoãn P7.4

Khiêm quyết định hoãn tính năng OCR sổ Báp-têm viết tay vì chưa cần cho nhu cầu hiện tại. 74-01 còn mở và hoãn. P7.4-plan-r3 dừng ở đề xuất, các bước thu mẫu và huấn luyện r3 chưa bắt đầu. Tập nghiệm thu độc lập 28 trang chưa mở.

Giữ lại kết quả r1, r2 và nghiệm thu riêng 74-02, 74-03 ở phạm vi local/synthetic. P7.4 chưa phát hành. P7.5 chưa mở. Khi có nhu cầu, Khiêm quyết định mở lại P7.4 và chốt phạm vi tiếp theo.

**Note nhắc lại khi rà soát roadmap P7/P8.** Nhắc Khiêm rằng OCR sổ Báp-têm đang hoãn, 74-01 còn mở và có thể xem lại hồ sơ này nếu phát sinh nhu cầu nhập sổ cũ. Đây là mục để nhắc lại trong lần rà soát, chưa phải điều kiện mở P7.5.
