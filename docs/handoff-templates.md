# Biên bản bàn giao — hai mẫu

Áp dụng theo trao đổi và yêu cầu “áp dụng vào” của Khiêm ngày 2026-11-10. Phạm vi: quy tắc và mẫu tài liệu cục bộ Church CMS. Đây không phải quyền triển khai ứng dụng hoặc phát hành. Các ô `[ngoặc vuông]` bên dưới là chỗ điền, không là bằng chứng sản phẩm đã hoàn thành.

## Quy tắc chung

- Trình bày biên bản trực tiếp trong chat, ưu tiên phần chính ngắn và liên kết chi tiết. Không chỉ gửi đường dẫn để thay biên bản. Giữ bảng skills theo AGENTS.md.
- Cả hai mẫu có **ảnh kết quả hoặc sơ đồ kỹ thuật thực tế** để kiểm tra bằng thị giác. Chọn loại giúp kiểm tra kết quả: ảnh cho giao diện/đầu ra quan sát được; sơ đồ cho cấu trúc, dữ liệu hoặc luồng xử lý, kể cả task tài liệu. Hiển thị ảnh hoặc sơ đồ ngay trong chat.
- Chú thích hình: phiên bản bàn giao, nguồn/cấu phần liên quan, trạng thái bằng chứng và giới hạn. Khi chưa có Git revision, dùng mã gói/task và phiên bản tài liệu; không bịa commit. Giữ nhãn ngắn theo hướng wordless, nhưng không bỏ quy tắc hoặc chú thích thiết yếu.
- Ảnh phải là kết quả thực sự quan sát được. Sơ đồ phải dựa trên tài liệu/source/kết quả hiện hành đã đối chiếu. Ghi rõ **Đã xác minh / Đề xuất / Chưa xác minh** cho nội dung tương ứng; một hình có thể chứa nhiều trạng thái. Không dùng mockup hoặc ảnh AI làm bằng chứng runtime; che dữ liệu nhạy cảm.
- Nếu chưa có bằng chứng trực quan thực tế, ghi rõ **CHƯA CÓ** và lý do. Không thay bằng hình giả hoặc gọi gói đủ nghiệm thu khi thiếu bằng chứng bắt buộc.
- Checklist ưu tiên 3–5 kiểm tra trọng tâm, điều chỉnh theo rủi ro; mỗi mục có thao tác/quan sát và kết quả mong đợi. Những thuộc tính như tenant isolation, quyền hoặc transaction cần bằng chứng kiểm thử thích hợp, không suy ra từ ảnh.
- Phân biệt hoàn tất nguồn, kiểm chứng hành vi, nghiệm thu của Khiêm và phát hành. PASS kỹ thuật không tự đánh dấu nghiệm thu. FAIL/NOT_RUN phải nêu nguyên nhân và ảnh hưởng.

<a id="phan-loai-khi-lap-ke-hoach"></a>

## Phân loại khi lập kế hoạch

Ngay đầu mọi kế hoạch, kể cả task nhỏ, agent phải nêu trực tiếp trong chat:

```text
Kiểu bàn giao: Một lần / Theo roadmap
Căn cứ:        [Vì sao có thể nghiệm thu cùng lúc hoặc cần chia gói]
Thuộc roadmap: [Tên/mã roadmap và gói liên quan, nếu có; hoặc Không]
```

Phân loại theo cách Khiêm có thể nghiệm thu kết quả. Số file, dòng code và thời gian dự kiến chỉ là thông tin hỗ trợ, không quyết định kiểu bàn giao. Khiêm duyệt phân loại cùng kế hoạch, không cần một vòng phê duyệt tách riêng.

Áp dụng theo thứ tự:

1. **Kiểm tra roadmap cha trước.** Nếu công việc là một gói/phần thuộc roadmap đã duyệt, chọn **Theo roadmap**; giữ vị trí, bức tranh tổng thể và điểm dừng đã chốt, dù gói nhỏ. Không tự tách thành task độc lập để bỏ điểm dừng. Sửa lỗi trong gói đang làm vẫn thuộc gói đó, không tạo gói giả.
2. **Xác định nhu cầu nghiệm thu nhiều lần.** Chọn **Theo roadmap** nếu kết quả cần nhiều lượt xem xét để kiểm soát: nhiều luồng nghiệp vụ, nhóm người dùng hoặc phần kết quả cần nghiệm thu riêng; hoặc quyết định/nghiệm thu phần trước ảnh hưởng phần sau. Có nhiều module/files tự nó không đủ căn cứ chia gói. Xác định trước các gói có ý nghĩa và điểm dừng để Khiêm duyệt.
3. **Kiểm tra khả năng bàn giao trọn vẹn.** Chọn **Một lần** nếu công việc không thuộc roadmap cha, phạm vi rõ, checklist tập trung và toàn bộ kết quả có thể đánh giá cùng lúc trong một lượt. Không tạo thêm giai đoạn chỉ để đáp ứng mẫu.

Nếu chưa đủ căn cứ, tiếp tục khảo sát read-only trong phạm vi được phép rồi trình phân loại cùng căn cứ; không tự bắt đầu implementation với phân loại chưa chốt. Nếu phát hiện phạm vi lớn hơn dự kiến, dừng phần mở rộng và trình kế hoạch/phân loại sửa đổi trước khi thực hiện; không tự đổi kiểu để vượt điểm nghiệm thu.

**Rủi ro là tiêu chí riêng.** Kiểu Một lần vẫn phải có kiểm tra bảo mật/dữ liệu/quyền phù hợp. Kiểu Theo roadmap không tự cấp quyền phát hành, migration hoặc thao tác dữ liệu thật.

| Trường hợp | Kiểu bàn giao | Căn cứ |
|---|---|---|
| Sửa thông báo lỗi đăng nhập ngoài roadmap | Một lần | Một kết quả có thể kiểm tra cùng luồng liên quan trong một lượt |
| Quản lý thuộc viên gồm hồ sơ, gia đình, import, phân quyền cần nghiệm thu riêng | Theo roadmap | Nhiều kết quả cần các lượt nghiệm thu riêng, gói phải được xác định trước |
| Một gói nhỏ đã nằm trong P0–P8 | Theo roadmap | Kế thừa roadmap và điểm dừng, không phụ thuộc kích thước gói |
| Sửa lỗi phân quyền phạm vi rõ, ngoài roadmap | Một lần | Một lượt nghiệm thu; vẫn bắt buộc kiểm tra quyền tương ứng |

Các trường hợp trên là ví dụ phân loại, không là phê duyệt tính năng hoặc bằng chứng đã triển khai ứng dụng.

## 1. Task dài — bàn giao từng gói

Trước implementation, chốt danh mục gói có ý nghĩa, mã/tên, kết quả, phụ thuộc và tiêu chí nghiệm thu. Lưu bức tranh đã duyệt trong [project-context](project-context.md), chi tiết trong [project-plan](project-plan.md), trạng thái hiện hành duy nhất trong [project-state](project-state.md). Gói hoàn chỉnh theo luồng/năng lực; không tách máy móc theo file hoặc lớp UI/API/database. Không tự sinh gói B sau khi xong A. Phần chưa chốt phải ghi rõ điểm quyết định, chưa được triển khai. Thay đổi danh mục/thứ tự/phạm vi cần duyệt kế hoạch sửa đổi.

Trong từng gói được phép, hoàn tất production code và wiring trước khi viết/cập nhật rồi chạy tests; bàn giao sau các kiểm tra áp dụng. Quy tắc này không yêu cầu viết toàn bộ P0–P8 trước khi kiểm thử gói đầu.

### [Mã gói · Tên gói · Phiên bản bàn giao]

**Bức tranh tổng thể — chỉ nêu tên**

```text
✓ Đã nghiệm thu:    [Tên các gói Khiêm đã chấp nhận]
◉ Chờ nghiệm thu:   [Tên gói đang bàn giao]
→ Tiếp theo:        [Tên gói kế tiếp trong kế hoạch]
○ Sau đó:          [Tên các gói còn lại theo thứ tự]
```

Nếu còn phần đang làm/bị chặn, ghi đúng trạng thái; không ép vào nhóm đã nghiệm thu. Không suy ra phần trăm tiến độ từ số gói vì kích thước có thể khác nhau.

**Ảnh kết quả / sơ đồ kỹ thuật thực tế — wordless**

[Hiển thị hình hoặc sơ đồ của gói tại đây. Chú thích: phiên bản · nguồn · Đã xác minh/Đề xuất/Chưa xác minh · giới hạn.]

**Outline**

- Kết quả: [Năng lực/luồng đã hoàn thành].
- Thành phần: [UI/API/dữ liệu/tích hợp hoặc tài liệu liên quan].
- Quy tắc và giới hạn: [Invariants, phần thiếu/chưa kiểm chứng].

**Checklist nghiệm thu**

- [ ] [Thao tác/quan sát] → [Kết quả mong đợi].
- [ ] [Ngoại lệ quan trọng] → [Kết quả mong đợi].
- [ ] [Kết nối với phần đã có] → [Kết quả mong đợi].

**Bằng chứng kỹ thuật**

| Kiểm tra | Kết quả thực tế và giới hạn | Bằng chứng |
|---|---|---|
| [Tên/lệnh, phiên bản và môi trường] | [PASS / FAIL / NOT_RUN; nguyên nhân nếu thiếu] | [Liên kết] |

**Bảng WHAT**

| Tên | Mục đích | Vị trí | Trạng thái | Lý do chưa làm/bỏ qua |
|---|---|---|---|---|
| [Hạng mục ổn định trong task] | [Kết quả] | [File/màn hình/module] | [Thực tế] | [Lý do hoặc —] |

**Skills:** [Bảng theo AGENTS.md; journal đã lưu nếu thuộc phạm vi được phép].

**Quyết định của Khiêm:** ☐ Chấp nhận ☐ Yêu cầu sửa ☐ Tạm dừng

**Đề xuất tiếp theo:** [1–3 lựa chọn có kết quả và điều kiện/quyền; gói tiếp theo phải có trong kế hoạch].

**Điểm dừng:** agent tự sửa lỗi trong phạm vi gói hiện tại; không tự mở gói tiếp theo. Chỉ tiếp tục khi Khiêm chấp nhận gói hiện tại **và** cho phép mở gói sau. Một chỉ dẫn rõ có thể bao gồm cả hai; im lặng hoặc duyệt roadmap không thay thế chỉ dẫn này.

## 2. Task ngắn — bàn giao một lần

Không thêm khối roadmap, “Chờ nghiệm thu / Tiếp theo / Sau đó” hoặc giai đoạn giả. Đề xuất tiếp theo không tự cấp quyền bắt đầu task khác.

### [Tên task · Phiên bản bàn giao]

**Outline**

- Kết quả: [Đã đổi gì và giải quyết việc gì].
- Phạm vi: [Thành phần bị tác động].
- Giới hạn: [Phần chưa kiểm chứng/còn thiếu, nếu có].

**Ảnh kết quả / sơ đồ kỹ thuật thực tế**

[Hiển thị hình hoặc sơ đồ tại đây. Chú thích: phiên bản · nguồn · Đã xác minh/Đề xuất/Chưa xác minh · giới hạn.]

**Checklist nghiệm thu**

- [ ] [Thao tác/quan sát] → [Kết quả mong đợi].
- [ ] [Ảnh hưởng liên quan] → [Kết quả mong đợi].

**Bằng chứng kỹ thuật**

| Kiểm tra | Kết quả thực tế và giới hạn | Bằng chứng |
|---|---|---|
| [Tên/lệnh, phiên bản và môi trường] | [PASS / FAIL / NOT_RUN; nguyên nhân nếu thiếu] | [Liên kết] |

**Bảng WHAT**

| Tên | Mục đích | Vị trí | Trạng thái | Lý do chưa làm/bỏ qua |
|---|---|---|---|---|
| [Hạng mục ổn định trong task] | [Kết quả] | [File/màn hình/module] | [Thực tế] | [Lý do hoặc —] |

**Skills:** [Bảng theo AGENTS.md; journal đã lưu nếu thuộc phạm vi được phép].

**Đề xuất tiếp theo:** [1–3 lựa chọn cụ thể; nếu task đã đủ, đề nghị Khiêm kiểm tra và chấp nhận kết quả].
