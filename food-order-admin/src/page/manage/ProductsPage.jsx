import { useEffect, useState } from "react";
import axios from "axios";

export default function ProductsPage() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [group, setGroup] = useState(""); // dùng như bộ lọc reportGroup
  const [menuTypes, setMenuTypes] = useState([]);

  async function load() {
    const r = await axios.get("/api/products", { params: { q, type, group, limit: 500 } });
    setRows(r.data.rows || []);
  }
  async function loadMenuTypes() {
    try {
      const r = await axios.get("/api/menu-types");
      setMenuTypes(Array.isArray(r.data) ? r.data : []);
    } catch {
      // fallback hard-code
      setMenuTypes([
        'SNACK TRAVEL','SNACK MENU','CLUB MENU','HOTEL MENU','VIP MENU',
        'WINE MENU - KOREAN','WINE MENU - ENGLISH','WINE MENU - CHINESE','WINE MENU - JAPANESE',
      ]);
    }
  }

  useEffect(() => { load(); }, [q, type, group]);
  useEffect(() => { loadMenuTypes(); }, []);

  async function onBootstrap() {
    const r = await axios.post("/api/products/bootstrap-from-images", { defaultMenuType: "", defaultGroup: "" });
    alert(`Đã tạo mới: ${r.data.created}`); load();
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center">
        <input placeholder="Tìm kiếm" value={q} onChange={e=>setQ(e.target.value)} className="border px-2 py-1"/>
        <select value={type} onChange={e=>setType(e.target.value)} className="border px-2 py-1">
          <option value="">Loại thực đơn</option>
          <option>đồ ăn</option><option>đồ uống</option><option>khác</option>
        </select>
        <input placeholder="Lọc theo Nhóm báo cáo" value={group} onChange={e=>setGroup(e.target.value)} className="border px-2 py-1"/>
        <button onClick={onBootstrap} className="border px-3 py-1">Lấy từ ảnh sẵn có</button>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50">
            <th className="text-left p-2">Mã món</th>
            <th className="text-left p-2">Tên món</th>
            <th className="text-left p-2">Loại thực đơn</th>
            <th className="text-left p-2">Nhóm báo cáo</th>
            <th className="text-left p-2">Menus</th>
            <th className="text-right p-2">Giá</th>
            <th className="text-left p-2">Ảnh</th>
            <th className="p-2">Sửa</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="border-b">
              <td className="p-2">{r.productCode}</td>
              <td className="p-2">{r.name}</td>
              <td className="p-2">{r.menuType}</td>
              <td className="p-2">{r.reportGroup || ''}</td>
              <td className="p-2">
                <div className="flex flex-wrap gap-1">
                  {(r.menus || []).map(m => (
                    <span key={m} className="px-2 py-0.5 bg-blue-50 border border-blue-200 rounded text-xs">{m}</span>
                  ))}
                </div>
              </td>
              <td className="p-2 text-right">{(r.price||0).toLocaleString()}</td>
              <td className="p-2"><img src={r.imageUrl} alt="" className="h-12 object-contain"/></td>
              <td className="p-2"><EditButton row={r} onSaved={load} menuTypes={menuTypes}/></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EditButton({ row, onSaved, menuTypes }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    id: row.id,
    productCode: row.productCode || '',
    name: row.name || '',
    menuType: row.menuType || '',
    reportGroup: row.reportGroup || '',
    price: row.price || 0,
    imageUrl: row.imageUrl,
    imageName: row.imageName,
    menus: Array.isArray(row.menus) ? [...row.menus] : [],
  });

  function toggleMenu(m) {
    setForm(f => {
      const set = new Set(f.menus || []);
      if (set.has(m)) set.delete(m); else set.add(m);
      return { ...f, menus: Array.from(set) };
    });
  }

  async function save() {
    const payload = {
      productCode: form.productCode,
      name: form.name,
      menuType: form.menuType,
      reportGroup: form.reportGroup,
      price: Number(form.price || 0),
      imageUrl: form.imageUrl,
      imageName: form.imageName,
      menus: form.menus, // <— quan trọng
    };
    await axios.put(`/api/products/${row.id}`, payload);
    setOpen(false);
    onSaved && onSaved();
  }

  if (!open) return <button className="border px-2 py-1" onClick={()=>setOpen(true)}>Sửa</button>;

  return (
    <div className="p-3 border rounded space-y-2 bg-white max-w-xl">
      <div className="grid grid-cols-2 gap-2">
        <input value={form.productCode} onChange={e=>setForm({...form,productCode:e.target.value})} placeholder="Mã món" className="border px-2 py-1"/>
        <input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Tên món" className="border px-2 py-1"/>
        <select value={form.menuType} onChange={e=>setForm({...form,menuType:e.target.value})} className="border px-2 py-1">
          <option value="">Loại thực đơn</option>
          <option>đồ ăn</option><option>đồ uống</option><option>khác</option>
        </select>
        <input value={form.reportGroup} onChange={e=>setForm({...form,reportGroup:e.target.value})} placeholder="Nhóm báo cáo (korea/china/...)" className="border px-2 py-1"/>
        <input type="number" value={form.price} onChange={e=>setForm({...form,price:+e.target.value})} placeholder="Giá" className="border px-2 py-1"/>
      </div>

      {/* Quản lý Menus */}
      <div className="space-y-1">
        <div className="font-medium">Menus (hiển thị)</div>
        <div className="flex flex-wrap gap-2">
          {menuTypes.map(m => {
            const checked = form.menus.includes(m);
            return (
              <label key={m} className={`px-2 py-1 border rounded cursor-pointer select-none ${checked ? 'bg-blue-100 border-blue-300' : ''}`}>
                <input
                  type="checkbox"
                  className="mr-1 align-middle"
                  checked={checked}
                  onChange={()=>toggleMenu(m)}
                />
                <span className="align-middle">{m}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={save} className="border px-3 py-1 bg-black text-white">Lưu</button>
        <button onClick={()=>setOpen(false)} className="border px-3 py-1">Đóng</button>
      </div>
    </div>
  );
}
