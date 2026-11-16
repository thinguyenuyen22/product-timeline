# Product Timeline Tracker

Web tĩnh (1 file `index.html`, không cần build) để theo dõi tiến độ sản phẩm theo năm, từ 2027 trở đi.

## Chạy thử
Mở `index.html` bằng trình duyệt, hoặc `npx serve .`

## Đưa lên GitHub
```bash
git init
git add .
git commit -m "Product timeline tracker"
git branch -M main
git remote add origin https://github.com/<tai-khoan>/<ten-repo>.git
git push -u origin main
```

## Deploy lên Vercel
1. Vào https://vercel.com/new và chọn repo vừa push.
2. Framework Preset: **Other**. Để trống Build Command và Output Directory.
3. Bấm **Deploy**.

## Lưu ý về dữ liệu
Dữ liệu lưu trong `localStorage` của trình duyệt, nên mỗi máy/trình duyệt có dữ liệu riêng.
Dùng nút **Xuất JSON** để sao lưu và **Nhập JSON** để chuyển sang máy khác.
Muốn nhiều người cùng dùng một dữ liệu, cần thêm backend (Supabase, Vercel KV/Postgres, Firebase...).
