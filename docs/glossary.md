# Bảng thuật ngữ — Ứng dụng quản lý Hội Thánh

**Tên miền** `hoithanh.app`

## Đối tượng sử dụng và đường dẫn

| Đối tượng | Công việc chính | Phạm vi |
|---|---|---|
| Mục sư | Theo dõi hoạt động, quản lý lịch giảng, theo dõi thăm viếng và tiếp nhận lời cầu thay riêng. Có thể xử lý đề xuất chi khi được giao quyền duyệt. | Hội Thánh của mình, theo quyền được cấp. |
| Thư ký Ban Chấp sự | Quản lý hồ sơ tín hữu, thân hữu, gia đình, điểm danh, lễ nghi và báo cáo nội bộ. | Hội Thánh của mình, theo quyền được cấp. |
| Thủ quỹ | Quản lý mã dâng hiến, lập phiếu thu, ghi nhận phiếu chi và theo dõi sổ thu chi. | Nghiệp vụ tài chính của Hội Thánh. |
| Trưởng ban | Điểm danh và theo dõi hoạt động trong đơn vị mình phụ trách. | Ban hoặc Khu vực được giao. |
| Tín hữu có tài khoản | Xem hồ sơ, lễ nghi, dâng hiến cá nhân và gửi lời cầu thay riêng. | Hồ sơ tín hữu đã liên kết với tài khoản. |
| Nhân viên vận hành của nhà cung cấp (Owner) | Thiết lập Hội Thánh, quản lý tài khoản và hỗ trợ vận hành. | Các Hội Thánh theo quyền được cấp. |

| Điểm vào | URL |
|---|---|
| Đăng nhập Owner | `https://hoithanh.app/owner/login` |
| Đăng nhập tài khoản Hội Thánh, gồm cả Tín hữu | `https://hoithanh.app/{churchCode}/login` |
| Mở trực tiếp Cổng tín hữu | `https://hoithanh.app/{churchCode}/portal` |

Thay `{churchCode}` bằng mã Hội Thánh có trong thông tin bàn giao tài khoản. Nếu mã là `HT-EXAMPLE234`, đường dẫn đăng nhập là `https://hoithanh.app/HT-EXAMPLE234/login`. Liên kết đã cấp theo dạng `/h/{churchCode}/…` chuyển hướng đến URL tương ứng và giữ tham số truy vấn. Đây là cấu trúc đường dẫn của ứng dụng, đã triển khai trong mã nguồn local. Xem [bàn giao tài khoản local](engineering/P1.3-accounts.md).

## Hội Thánh, con người và quyền truy cập

| Thuật ngữ | Nghĩa trong ứng dụng |
|---|---|
| Hội Thánh | Đơn vị quản lý có dữ liệu và cấu hình riêng. Phạm vi dữ liệu của một Hội Thánh được gọi là *tenant* trong tài liệu kỹ thuật. |
| Mã Hội Thánh (`churchCode`) | Mã do ứng dụng cấp khi tạo Hội Thánh. Đường dẫn dùng mã này để xác định Hội Thánh. Phiên đăng nhập và phân quyền quyết định quyền truy cập. |
| Thuộc viên | Tên màn hình quản lý hồ sơ Tín hữu và Thân hữu. |
| Tín hữu | Loại hồ sơ có phân loại Dự bị, Thành viên hoặc Thiếu nhi. Tín hữu cũng là tên vai trò tài khoản dùng Cổng tín hữu. |
| Thân hữu | Loại hồ sơ theo dõi và chăm sóc người mới đến hoặc đang tìm hiểu. Các giai đoạn gồm Mới đến, Đang tìm hiểu và Đã tin Chúa. |
| Gia đình | Nhóm hồ sơ có quan hệ gia đình hoặc cùng hộ. |
| Ban ngành & Khu vực | Các đơn vị phục vụ và địa bàn sinh hoạt trong Hội Thánh. |
| Tài khoản Hội Thánh | Danh tính đăng nhập thuộc một Hội Thánh. Với vai trò Tín hữu, tài khoản cần được liên kết với hồ sơ cá nhân để dùng Cổng tín hữu. |
| Vai trò và phân quyền | Vai trò xác định nhóm trách nhiệm. Quyền xác định dữ liệu và thao tác được phép. Chấp sự là chức vụ trong Hội Thánh, còn quyền ứng dụng được cấp qua vai trò tài khoản. |
| Owner | Tài khoản vận hành riêng của nhân viên nhà cung cấp. |
| Cổng tín hữu | Khu vực xem hồ sơ, lễ nghi, dâng hiến của mình và gửi, theo dõi lời cầu thay riêng. |

## Sinh hoạt, lễ nghi và chăm sóc

| Thuật ngữ | Nghĩa trong ứng dụng |
|---|---|
| Buổi điểm danh | Bản ghi sự hiện diện của một buổi cụ thể. Các trạng thái gồm Nháp, Đang mở và Đã chốt. |
| Điểm danh tay / Điểm danh QR | Đánh dấu hiện diện trực tiếp hoặc quét mã QR trên thẻ thuộc viên. |
| Thẻ thuộc viên | Thẻ gắn với hồ sơ thuộc viên, có mã QR phục vụ điểm danh. |
| Lớp dự bị | Nhóm học theo dõi quá trình chuẩn bị trước Báp-têm. |
| Sổ lễ nghi | Nơi quản lý các bản ghi Báp-têm, Dâng con, Thành hôn, An táng và Tiệc Thánh. |
| Báp-têm | Một lễ nghi lưu trong Sổ lễ nghi. Hồ sơ thuộc viên có trường riêng thể hiện tình trạng Báp-têm. |
| Lịch giảng | Lịch phân công giảng cho các buổi thờ phượng. Chế độ đọc lịch giảng hiển thị chi tiết buổi đã xếp lịch bằng chữ lớn. |
| Hồ sơ thăm viếng | Bản ghi theo dõi nhu cầu thăm viếng, người phụ trách và quá trình chăm sóc. |
| Gợi ý chăm sóc | Tín hiệu để người phụ trách xem xét nhu cầu chăm sóc, ví dụ từ dữ liệu vắng sinh hoạt. |
| Lời cầu thay | Yêu cầu cầu nguyện được ghi theo phạm vi chia sẻ. Lời cầu thay riêng thuộc phạm vi đọc của Mục sư cùng Hội Thánh. Tín hữu gửi qua cổng có thể theo dõi yêu cầu của mình. |

## Tài chính

| Thuật ngữ | Nghĩa trong ứng dụng |
|---|---|
| Quỹ | Đơn vị theo dõi khoản thu, chi và số dư trong Hội Thánh. |
| Dâng hiến | Khoản đóng góp vào quỹ. Cổng tín hữu hiển thị phần cá nhân trên phiếu thu chi tiết còn hiệu lực. |
| Mã dâng hiến | Mã gắn khoản dâng hiến chi tiết với hồ sơ trong Hội Thánh. |
| Phiếu thu tổng hợp | Phiếu ghi một số tiền chung vào quỹ, ví dụ tổng của một buổi. |
| Phiếu thu chi tiết | Phiếu có các dòng theo mã dâng hiến và số tiền tương ứng. |
| Đề xuất chi | Yêu cầu xin phê duyệt một khoản chi trước khi lập phiếu chi. |
| Hạn mức duyệt / Cấp duyệt | Ngưỡng tiền để xác định thẩm quyền xử lý đề xuất khi Hội Thánh bật quy tắc duyệt theo hạn mức. |
| Chứng từ đề xuất chi | Ảnh tài liệu đính kèm làm căn cứ xem xét đề xuất. Quyền xem ảnh đi theo quyền của đề xuất. |
| Phiếu chi | Bản ghi khoản chi lập từ đề xuất đã duyệt và ghi vào sổ thu chi. |
| Sổ thu chi | Nơi theo dõi bút toán thu, chi và số dư theo kỳ và quỹ. |
| Kỳ sổ / Khóa sổ | Kỳ sổ là tháng nghiệp vụ. Khóa sổ chặn ghi nhận mới vào các kỳ đã khóa. |
| Bút toán đối ứng | Bút toán đảo tác động của khoản ghi sổ gốc khi hủy hợp lệ, đồng thời giữ dấu vết giao dịch. |

## Biểu mẫu, báo cáo và nhập liệu

| Thuật ngữ | Nghĩa trong ứng dụng |
|---|---|
| Nhập dữ liệu (import) | Đưa dữ liệu từ tệp vào ứng dụng. Nhập hồ sơ có bước xem trước và đối soát trước khi ghi. |
| Biểu mẫu nội bộ | Mẫu dùng để lập giấy xác nhận hoặc hồ sơ nội bộ Hội Thánh. |
| Mẫu báo cáo | Tệp Excel quy định bố cục và vị trí các chỉ tiêu. Mỗi Hội Thánh có thể dùng mẫu hiện hành riêng. |
| Bản xem trước | Kết quả tạm để kiểm tra dữ liệu và bố cục trước khi xác nhận. |
| Bản chốt | Phiên bản xác nhận, lưu dữ liệu và tệp tại thời điểm chốt. |
| OCR sổ Báp-têm | Nhận dạng chữ trên ảnh sổ để hỗ trợ nhập liệu. Hạng mục P7.4 đang hoãn. |

Nguồn đối chiếu: [vai trò và phạm vi](../web/accounts-api.ts), [Cổng tín hữu](engineering/P6.3-member-portal.md), [lời cầu thay](engineering/P4.4-prayers.md), [thu và dâng hiến](engineering/P5.2-income.md), [phiếu chi](engineering/P5.4-payments.md), [báo cáo Hội Thánh](engineering/P6.2-church-reports.md) và [trạng thái dự án](project-state.md).
