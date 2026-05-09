import { Navigate, Route, Routes } from "react-router-dom";
import { Protected } from "@/auth/Protected";
import Landing from "@/pages/public/Landing";
import AdminLogin from "@/pages/public/AdminLogin";
import AdminSetup from "@/pages/public/AdminSetup";
import OrgLogin from "@/pages/public/OrgLogin";
import EmployeeLogin from "@/pages/public/EmployeeLogin";
import ForgotPassword from "@/pages/public/ForgotPassword";
import ResetPassword from "@/pages/public/ResetPassword";
import AcceptInvite from "@/pages/public/AcceptInvite";
import TotpChallenge from "@/pages/public/TotpChallenge";
import TotpSetup from "@/pages/public/TotpSetup";
import AdminLayout from "@/pages/admin/AdminLayout";
import AdminDashboard from "@/pages/admin/AdminDashboard";
import AdminOrgs from "@/pages/admin/AdminOrgs";
import AdminOrgDetail from "@/pages/admin/AdminOrgDetail";
import AdminUsers from "@/pages/admin/AdminUsers";
import AdminRequests from "@/pages/admin/AdminRequests";
import AdminRequestDetail from "@/pages/admin/AdminRequestDetail";
import AdminAudit from "@/pages/admin/AdminAudit";
import AdminSettings from "@/pages/admin/AdminSettings";
import AdminProfile from "@/pages/admin/AdminProfile";
import OrgLayout from "@/pages/org/OrgLayout";
import OrgDashboard from "@/pages/org/OrgDashboard";
import OrgRequests from "@/pages/org/OrgRequests";
import OrgRequestNew from "@/pages/org/OrgRequestNew";
import OrgRequestDetail from "@/pages/org/OrgRequestDetail";
import OrgUsers from "@/pages/org/OrgUsers";
import OrgFormBuilder from "@/pages/org/OrgFormBuilder";
import OrgResources from "@/pages/org/OrgResources";
import OrgProfile from "@/pages/org/OrgProfile";
import OrgSettings from "@/pages/org/OrgSettings";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />

      {/* Generic employee login (auto-resolves org) */}
      <Route path="/login" element={<EmployeeLogin />} />

      {/* 2FA flows (post password) */}
      <Route path="/login/totp" element={<TotpChallenge />} />
      <Route path="/login/totp-setup" element={<TotpSetup />} />

      {/* Global Admin */}
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/admin/setup" element={<AdminSetup />} />
      <Route path="/admin" element={
        <Protected roles={["global_admin"]} redirectTo="/admin/login"><AdminLayout /></Protected>
      }>
        <Route index element={<AdminDashboard />} />
        <Route path="organizations" element={<AdminOrgs />} />
        <Route path="organizations/:orgId" element={<AdminOrgDetail />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="requests" element={<AdminRequests />} />
        <Route path="requests/:id" element={<AdminRequestDetail />} />
        <Route path="audit" element={<AdminAudit />} />
        <Route path="settings" element={<AdminSettings />} />
        <Route path="profile" element={<AdminProfile />} />
      </Route>

      {/* Public org routes (no layout) */}
      <Route path="/:orgSlug/login" element={<OrgLogin />} />
      <Route path="/:orgSlug/forgot" element={<ForgotPassword />} />
      <Route path="/:orgSlug/reset" element={<ResetPassword />} />
      <Route path="/:orgSlug/accept" element={<AcceptInvite />} />
      <Route path="/accept" element={<AcceptInvite />} />

      {/* Org portal */}
      <Route path="/:orgSlug" element={
        <Protected><OrgLayout /></Protected>
      }>
        <Route index element={<OrgDashboard />} />
        <Route path="requests" element={<OrgRequests />} />
        <Route path="requests/new" element={<OrgRequestNew />} />
        <Route path="requests/:id" element={<OrgRequestDetail />} />
        <Route path="users" element={
          <Protected roles={["client_admin", "global_admin"]}><OrgUsers /></Protected>
        } />
        <Route path="form" element={
          <Protected roles={["client_admin", "global_admin"]}><OrgFormBuilder /></Protected>
        } />
        <Route path="resources" element={
          <Protected roles={["client_admin", "global_admin"]}><OrgResources /></Protected>
        } />
        <Route path="settings" element={
          <Protected roles={["client_admin", "global_admin"]}><OrgSettings /></Protected>
        } />
        <Route path="profile" element={<OrgProfile />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
