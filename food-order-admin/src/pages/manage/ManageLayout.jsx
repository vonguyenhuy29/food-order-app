import { NavLink, Outlet } from "react-router-dom";

export default function ManageLayout() {
  const tabs = [
    { to: "products", label: "Hàng hóa" },
    // sau này: tables, customers, reports, analytics
  ];
  return (
    <div className="p-4">
      <div className="flex gap-2 mb-4 border-b">
        {tabs.map(t => (
          <NavLink key={t.to} to={t.to}
            className={({isActive}) => `px-3 py-2 ${isActive ? 'border-b-2 font-semibold' : ''}`}>
            {t.label}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  );
}
