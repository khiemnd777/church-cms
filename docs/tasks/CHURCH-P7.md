# P7-plan-r2 — Kế hoạch đã duyệt

## Chốt P7

Khiêm chốt P7 với P7.1–P7.3 đã nghiệm thu local/synthetic, P7.4–P7.5 hoãn. Phạm vi PR gồm mã và kiểm thử của ba chặng đã nghiệm thu, cùng hồ sơ và note hai chặng hoãn. Mã OCR P7.4 giữ local. P7.4 giữ nghiệm thu riêng 74-02/03 tại local và 74-01 hoãn. P7.5 dừng ở đề xuất. P8 chưa mở.

[Biên bản chốt](../engineering/skill-usage/records/CHURCH-P7/P7-closure-1.json) liên kết nghiệm thu [P7.1](../engineering/skill-usage/records/CHURCH-P7/P7.1-human-acceptance-1.json), [P7.2](../engineering/skill-usage/records/CHURCH-P7/P7.2-human-acceptance-1.json) và [P7.3](../engineering/skill-usage/records/CHURCH-P7/P7.3-human-acceptance-1.json).

## Kế hoạch gốc

Khiêm duyệt toàn bộ P7.1–P7.5 và cho triển khai P7.1 local/synthetic theo C71 và ASCII. Bàn giao P7.1 rồi dừng trước P7.2. Sau mỗi lần bàn giao, Khiêm nghiệm thu và cho mở chặng tiếp theo. Chỉ trình lại phần thay đổi quan trọng hoặc đầu vào cần chốt. Quyền thao tác dữ liệu thật, kết nối dịch vụ ngoài, kích hoạt main và phát hành cần chỉ dẫn riêng.

**Kiểu bàn giao:** Theo roadmap · Church CMS P0–P8 · P7. P6 đã đóng local/synthetic. P7 xử lý năm mục trong roadmap và OPEN-07/10 của P0. P8 giữ pilot nhiều Hội Thánh, chuyển dữ liệu, phục hồi và phát hành. [Roadmap](../project-plan.md) · [P0](CHURCH-P0.md) · [Trạng thái](../project-state.md).

## P7.1 — Màn chữ lớn

**C71.** Từ chi tiết một buổi đã lên lịch trên W07, mở màn chỉ đọc ngày/giờ, chủ đề, tham chiếu Kinh Thánh và người giảng. Trường thiếu hiển thị `—`. Dùng phép đọc chi tiết Scheduling và quyền tài khoản hiện hành theo Hội Thánh, vai trò và ban. Tải lại đọc nguồn hiện hành và xóa dữ liệu cũ khi phiên hết hạn, quyền mất hoặc buổi bị hủy. Quay lại đúng chi tiết với bộ lọc ban đầu. Kiểu chữ lớn chỉ áp dụng trong chế độ này. [Hồ sơ P7.1](CHURCH-P7.1.md).

```text
W07 > Chi tiết buổi > [Chữ lớn]
[Quay lại]                              [Tải lại]
Chúa nhật 22/11 · 08:00

             NIỀM TIN VÀ HY VỌNG
                   Rô-ma 15:13

Người giảng   Nguyễn Văn A
```

- **71-01** Mở từ W07 và URL trực tiếp. Tiêu đề dài, tiếng Việt và dữ liệu thiếu đọc được trên tablet ngang/dọc và mobile. Dùng được bằng bàn phím.
- **71-02** Sửa lịch rồi tải lại. Quay lại khôi phục đúng chi tiết và bộ lọc.
- **71-03** Kiểm hủy lịch, hết phiên, mất quyền, URL khác tenant và hồi quy W07.

## P7.2 — Chứng từ đề xuất chi

**C72.** Một ảnh JPEG/PNG tùy chọn tối đa 5 MiB ở lúc lập đề xuất. Chọn, xem, thay hoặc bỏ trước lúc gửi. Finance giữ ảnh tạm có hạn dùng theo actor/tenant, kiểm định dạng thực, kích thước và giải mã, bỏ metadata không cần thiết. Giao dịch gửi gắn ảnh đã kiểm tra và checksum cùng đề xuất, lịch sử, audit và biên nhận. Ảnh đã gắn cố định theo đề xuất. Gửi lại cùng ý định trả cùng kết quả. Dọn ảnh tạm hết hạn.

Xem/tải qua endpoint kiểm lại quyền đọc chính đề xuất. Danh sách chỉ hiện có chứng từ. Đề xuất cũ hiển thị **Chưa có chứng từ**. Chốt chính sách lưu ảnh trước khi dùng dữ liệu thật. Nếu Hội Thánh cần hóa đơn bắt buộc ở bước quyết toán, trình lại phần thời điểm ghi và quyền trước coding. [Expenses](../engineering/P5.3-expenses.md).

```text
W10 > Lập đề xuất chi
Quỹ [........]        Số tiền [........]
Nội dung [.............................]
Chứng từ (tùy chọn)          [Chọn ảnh]
hoa-don.jpg                  [Xem] [Bỏ]
                         [Hủy] [Xem trước]
W10 > Chi tiết DX-012 > Chứng từ > [Xem] [Tải]
```

- **72-01** Gửi có/thiếu ảnh, đọc đề xuất cũ, tải đúng checksum.
- **72-02** Từ chối file sai, lỗi hoặc quá cỡ, ảnh tạm của người khác, tải sau mất quyền và khác tenant.
- **72-03** Mô phỏng lỗi giữa chừng và mất phản hồi. Đối soát một đề xuất và một chứng từ. Kiểm dọn ảnh tạm, backup/restore synthetic và checksum.

## P7.3 — Chọn cấp duyệt theo hạn mức

**C73.** Mục sư cấu hình một ngưỡng VND và một vai trò cho mỗi dải dưới ngưỡng/từ ngưỡng. Dùng đúng một quyết định cho mỗi đề xuất. Hội Thánh chọn ngưỡng và vai trò thực tế. Ví dụ 5 triệu chỉ minh họa. Nếu nghiệp vụ cần nhiều quyết định tuần tự, trình lại C73, trạng thái và checklist trước coding.

W12 xem trước cấu hình và lưu phiên bản. Khi tắt, luồng P5 tiếp tục. Đề xuất mới ghi cấp và phiên bản quy tắc lúc gửi. Đổi cấu hình giữa preview và gửi yêu cầu preview mới. Đề xuất cũ theo P5.3, đổi ngưỡng chỉ định tuyến đề xuất mới. W10 thêm phạm vi **Cần tôi duyệt**. Quyền từng dòng áp trước filter, số đếm, file, chi tiết và lịch sử. Backend kiểm vai trò hiện hành, cấm tự duyệt và ghi một kết quả mỗi phiên bản. Hồ sơ thiếu người đủ quyền tiếp tục chờ. Thủ quỹ lập phiếu sau khi duyệt qua kiểm quỹ, số dư và kỳ hiện hữu. [Expenses](../engineering/P5.3-expenses.md) · [Payments](../engineering/P5.4-payments.md).

```text
W12 > Cấu hình duyệt chi
Duyệt theo hạn mức [Tắt / Bật]
Ngưỡng [........] VND
Dưới ngưỡng [Chọn vai trò]
Từ ngưỡng   [Chọn vai trò]             [Xem trước]

W10 > [Của tôi] [Cần tôi duyệt]
DX-012 · Chờ duyệt · Cấp {vai trò}
[Chứng từ] [Lịch sử]              [Từ chối] [Duyệt]
```

- **73-01** Kiểm dưới/bằng/trên ngưỡng, đổi cấu hình, tính năng tắt và đề xuất cũ.
- **73-02** Kiểm sai dải, tự duyệt, mất vai trò và xử lý đồng thời. Chỉ một quyết định hợp lệ. Quyền áp cho dòng, đếm, file và lịch sử.
- **73-03** Chạy xuyên chứng từ, duyệt, lập phiếu, vào sổ. Đối chiếu số tiền, một phiếu/đề xuất và các điều kiện chặn quỹ/kỳ.

## P7.4 — OCR sổ Báp-têm viết tay

**Đã hoãn.** 74-01 còn mở, 74-02 và 74-03 đã nghiệm thu local/synthetic. Khi rà soát roadmap P7/P8, nhắc Khiêm xem lại nếu phát sinh nhu cầu nhập sổ cũ. [Note P7.4](CHURCH-P7.4.md#quyết-định-hoãn-p74).

**C74.** Thư ký xử lý một trang qua chọn ảnh → đọc → đối soát → xem trước → ghi nhận từng dòng. Xem ảnh nguồn cạnh kết quả đọc tên, ngày, nơi và người cử hành. Mobile xếp dọc. Người dùng sửa hoặc bỏ dòng rồi chọn đúng hồ sơ cùng tenant. Dòng chưa khớp hồ sơ chờ đối soát. Ngày chưa rõ dùng contract lịch sử. Dòng trùng dẫn tới bản đã ghi. Đính chính dùng luồng hiện hành. Chỉ xác nhận mới gọi Rites để kiểm nguồn, quyền và trùng. Khóa thao tác theo dòng để đối soát mất phản hồi. [Rites](../engineering/P3.4-rites.md).

Trước mở chặng, chốt bộ ảnh đại diện được phép, nhãn đối chiếu, mức chất lượng theo trường và thời hạn giữ dữ liệu. Nếu xử lý ngoài, duyệt nhà cung cấp, dữ liệu gửi, quyền xử lý và trần chi phí. Bộ giả lập chỉ kiểm UI, quyền và giao dịch. Chất lượng OCR đo riêng.

```text
W06 > Báp-têm > [Nhập từ ảnh sổ cũ]
[Chọn ảnh] [Đọc ảnh]       Dòng 2 / 8 · Cần kiểm tra
Ảnh trang sổ               Hồ sơ [Tìm chọn]
[Phóng ảnh]                Ngày  [Chưa rõ]
                           Nơi / Người cử hành
                           [Bỏ qua dòng] [Xem trước]
```

- **74-01** Đo trường đúng, sai, bỏ sót và dòng cần đối soát trên bộ ảnh đã duyệt, gồm ảnh mờ, tên giống và nhiều cách ghi ngày.
- **74-02** Kiểm dòng thiếu ngày, chưa khớp người hoặc trùng. Chỉ ghi dòng đã xác nhận và hợp lệ qua Rites.
- **74-03** Kiểm timeout, mất quyền, nguồn đổi sau preview và gửi lại. Kiểm chống ghi trùng và dọn ảnh đúng cấu hình.

## P7.5 — Nhắc ngoài và lời chúc sinh nhật

**Đã hoãn theo quyết định của Khiêm.** Hai luồng cần ngân sách và hạ tầng vận hành cho dịch vụ Email, SMS hoặc Zalo. P7.5-plan-r1 dừng ở đề xuất, gồm Email Resend cho W08 và SMS Brandname eSMS có điều kiện cho W01. Các kênh, nhà cung cấp và ngân sách chưa được duyệt. 75-01–75-03 chưa triển khai.

**Note nhắc lại khi rà soát roadmap P7/P8.** Nhắc Khiêm về hai luồng đang hoãn. Khi có nhu cầu mở lại, xem lại kênh phù hợp ở Việt Nam, kể cả Zalo, cùng chi phí, điều kiện nhà cung cấp và phạm vi thử nghiệm.

**C75.** Hai luồng có kiểm soát. W08 nhắc lịch thăm viếng cho người phụ trách đã xác minh kênh và có quyền mở hồ sơ. Tin chứa lời nhắc chung và liên kết yêu cầu đăng nhập. W01 dùng nguồn sinh nhật Members và quy tắc 29/2 hiện hành. Người phụ trách xem trước và xác nhận từng lời chúc cho người đã đồng ý nhận. Mỗi luồng tối đa một kênh khi mở chặng, Zalo/email cho nhắc việc, Zalo/SMS cho lời chúc. Chốt nhà cung cấp, quyền liên hệ, mẫu tin, lịch theo Asia/Ho_Chi_Minh, chi phí và dữ liệu chuyển đi. [Visitation](../engineering/P4.3-visitation.md) · [Members](../engineering/P2.2-members.md).

Mỗi lượt có định danh bền vững theo việc hoặc dịp sinh nhật, người nhận và kênh. Kiểm lại lịch, người nhận, quyền và trạng thái liên hệ trước khi gọi kênh. Nguồn đổi trước bước gửi thì hủy lượt chờ cũ. Kênh tiếp nhận là trạng thái chấp nhận yêu cầu. Nếu mất phản hồi, ghi **Chưa xác định** và đối soát trước khi thử lại. Khi restore giữ tiến trình gửi tắt cho tới khi đối soát quanh mốc backup.

```text
W08 > Chi tiết việc > Nhắc việc
Người nhận {đã xác minh}     Kênh {đã duyệt}
Ngày [........]  Giờ [.....]             [Xem trước]
Lần gửi gần nhất · Chưa xác định          [Đối soát]

W01 > Sinh nhật hôm nay > [Xem lời chúc]
Người nhận {đủ điều kiện}    Kênh {đã duyệt}
Nội dung {mẫu lời chúc}                [Hủy] [Xác nhận gửi]
```

- **75-01** Kiểm đến hạn, đổi/hủy lịch, đổi người nhận, thiếu xác minh và mất quyền. Tin không đưa tên người được chăm sóc, lý do thăm hoặc lời cầu thay ra ngoài.
- **75-02** Kiểm 29/2, ngày sinh thiếu, chưa đồng ý và xác nhận lặp. Chỉ một ý định hợp lệ theo người/dịp/kênh.
- **75-03** Kiểm hai tiến trình nhận việc, mất phản hồi sau tiếp nhận và tình huống restore. Giữ trạng thái chưa rõ khi thiếu bằng chứng. Kiểm sandbox nhà cung cấp khi được phép.

## Kiểm chứng chung

Hoàn tất source và wiring từng chặng trước khi viết/cập nhật tests. Chạy lint, typecheck, build, ui:check, test tập trung và hồi quy theo luồng. Browser kiểm desktop/tablet/mobile, light/dark, bàn phím, các trạng thái áp dụng và khoảng cách đo thực theo UI-COMPOSITION-r1. Bàn giao bằng chứng local/synthetic để Khiêm nghiệm thu từng chặng. E51-01 đã được bỏ qua, E55-01 còn mở đến trước production, UI-POSTP8-01 xử lý sau P8.
