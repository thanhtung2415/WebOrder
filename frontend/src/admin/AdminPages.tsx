import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormEvent, ReactElement, ReactNode } from "react";
import { useMemo, useState } from "react";
import { ApiClientError } from "../services/api-client";
import {
  AccountStatus,
  Branch,
  Permission,
  Role,
  StaffMember,
  approveStaff,
  changeStaffStatus,
  createBranch,
  createRole,
  listBranches,
  listPermissions,
  listRoles,
  listStaff,
  rejectStaff,
  replaceRolePermissions,
  replaceStaffRoles,
  updateBranch,
  updateRole
} from "./admin-api";
import { useAdminContext } from "./admin-context";

const statusOptions: Array<AccountStatus | ""> = ["", "PENDING", "ACTIVE", "LOCKED", "INACTIVE", "REJECTED"];

export function StaffManagementPage(): ReactElement {
  const admin = useAdminContext();
  const queryClient = useQueryClient();
  const context = useMemo(() => ({ accessToken: admin.accessToken, branchId: admin.activeBranchId }), [admin.accessToken, admin.activeBranchId]);
  const [filters, setFilters] = useState({ q: "", status: "", role: "" });
  const [roleSelections, setRoleSelections] = useState<Record<string, string>>({});
  const rolesQuery = useQuery({ queryKey: ["roles", context], queryFn: () => listRoles(context), enabled: admin.hasPermission("ROLE_READ") });
  const staffQuery = useQuery({
    queryKey: ["staff", context, filters],
    queryFn: () => listStaff(context, filters),
    enabled: admin.hasPermission("STAFF_READ")
  });

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ["staff"] });
  };
  const approveMutation = useMutation({ mutationFn: ({ staffId, roleId }: { staffId: string; roleId: string }) => approveStaff(context, staffId, [roleId]), onSuccess: refresh });
  const rejectMutation = useMutation({ mutationFn: ({ staffId, reason }: { staffId: string; reason: string }) => rejectStaff(context, staffId, reason), onSuccess: refresh });
  const statusMutation = useMutation({ mutationFn: ({ staffId, status, reason }: { staffId: string; status: AccountStatus; reason?: string }) => changeStaffStatus(context, staffId, status, reason), onSuccess: refresh });
  const rolesMutation = useMutation({ mutationFn: ({ staffId, roleId }: { staffId: string; roleId: string }) => replaceStaffRoles(context, staffId, [roleId]), onSuccess: refresh });
  const roles = rolesQuery.data ?? [];

  function selectedRole(staff: StaffMember): string {
    return roleSelections[staff.id] ?? staff.branches[0]?.roles[0]?.id ?? roles[0]?.id ?? "";
  }

  async function approve(staff: StaffMember): Promise<void> {
    const roleId = selectedRole(staff);
    if (!roleId) {
      window.alert("Chọn role trước khi duyệt.");
      return;
    }
    if (window.confirm(`Duyệt tài khoản ${staff.email}?`)) {
      await approveMutation.mutateAsync({ staffId: staff.id, roleId });
    }
  }

  async function reject(staff: StaffMember): Promise<void> {
    const reason = window.prompt("Nhập lý do từ chối");
    if (reason?.trim()) {
      await rejectMutation.mutateAsync({ staffId: staff.id, reason: reason.trim() });
    }
  }

  async function setStatus(staff: StaffMember, status: AccountStatus): Promise<void> {
    const reason = status === "ACTIVE" ? undefined : window.prompt(`Nhập lý do chuyển ${status}`);
    if (status !== "ACTIVE" && !reason?.trim()) {
      return;
    }
    if (window.confirm(`Chuyển ${staff.email} sang ${status}?`)) {
      await statusMutation.mutateAsync({ staffId: staff.id, status, reason: reason?.trim() });
    }
  }

  async function assignRole(staff: StaffMember): Promise<void> {
    const roleId = selectedRole(staff);
    if (roleId && window.confirm(`Cập nhật role cho ${staff.email}?`)) {
      await rolesMutation.mutateAsync({ staffId: staff.id, roleId });
    }
  }

  if (!admin.hasPermission("STAFF_READ")) {
    return <ForbiddenPanel />;
  }

  return (
    <AdminSection title="Staff Management" description="Duyệt tài khoản, phân quyền và quản lý trạng thái nhân viên.">
      <div className="grid gap-3 border-b border-border pb-4 md:grid-cols-3">
        <input className={inputClass} placeholder="Search email/name" value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} />
        <select className={inputClass} value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
          {statusOptions.map((status) => (
            <option key={status || "ALL"} value={status}>
              {status || "All statuses"}
            </option>
          ))}
        </select>
        <select className={inputClass} value={filters.role} onChange={(event) => setFilters({ ...filters, role: event.target.value })}>
          <option value="">All roles</option>
          {roles.map((role) => (
            <option key={role.id} value={role.code}>
              {role.code}
            </option>
          ))}
        </select>
      </div>
      <QueryState isLoading={staffQuery.isLoading} error={staffQuery.error} empty={(staffQuery.data ?? []).length === 0} />
      <div className="grid gap-3">
        {(staffQuery.data ?? []).map((staff) => (
          <article key={staff.id} className="rounded-md border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">{staff.displayName}</h2>
                <p className="text-sm text-muted-foreground">{staff.email}</p>
              </div>
              <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">{staff.status}</span>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">Roles: {staff.branches[0]?.roles.map((role) => role.code).join(", ") || "None"}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select className={inputClass} value={selectedRole(staff)} onChange={(event) => setRoleSelections({ ...roleSelections, [staff.id]: event.target.value })}>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.code}
                  </option>
                ))}
              </select>
              {staff.status === "PENDING" && admin.hasPermission("STAFF_APPROVE") ? <ActionButton onClick={() => void approve(staff)}>Approve</ActionButton> : null}
              {staff.status === "PENDING" && admin.hasPermission("STAFF_REJECT") ? <ActionButton onClick={() => void reject(staff)}>Reject</ActionButton> : null}
              {admin.hasPermission("STAFF_ROLE_MANAGE") ? <ActionButton onClick={() => void assignRole(staff)}>Assign Role</ActionButton> : null}
              {staff.status === "ACTIVE" && admin.hasPermission("STAFF_STATUS_MANAGE") ? <ActionButton onClick={() => void setStatus(staff, "LOCKED")}>Lock</ActionButton> : null}
              {staff.status === "LOCKED" && admin.hasPermission("STAFF_STATUS_MANAGE") ? <ActionButton onClick={() => void setStatus(staff, "ACTIVE")}>Unlock</ActionButton> : null}
              {staff.status === "ACTIVE" && admin.hasPermission("STAFF_STATUS_MANAGE") ? <ActionButton onClick={() => void setStatus(staff, "INACTIVE")}>Inactivate</ActionButton> : null}
            </div>
          </article>
        ))}
      </div>
    </AdminSection>
  );
}

export function BranchManagementPage(): ReactElement {
  const admin = useAdminContext();
  const queryClient = useQueryClient();
  const context = useMemo(() => ({ accessToken: admin.accessToken, branchId: admin.activeBranchId }), [admin.accessToken, admin.activeBranchId]);
  const [form, setForm] = useState({ code: "", name: "", timezone: "Asia/Ho_Chi_Minh" });
  const branchesQuery = useQuery({ queryKey: ["branches", context], queryFn: () => listBranches(context), enabled: admin.hasPermission("BRANCH_READ") });
  const createMutation = useMutation({
    mutationFn: () => createBranch(context, form),
    onSuccess: async () => {
      setForm({ code: "", name: "", timezone: "Asia/Ho_Chi_Minh" });
      await queryClient.invalidateQueries({ queryKey: ["branches"] });
      await queryClient.invalidateQueries({ queryKey: ["auth-me"] });
    }
  });
  const updateMutation = useMutation({ mutationFn: ({ branch, status }: { branch: Branch; status: Branch["status"] }) => updateBranch(context, branch.id, { status }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["branches"] }) });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (admin.hasPermission("BRANCH_MANAGE")) {
      createMutation.mutate();
    }
  }

  if (!admin.hasPermission("BRANCH_READ")) {
    return <ForbiddenPanel />;
  }

  return (
    <AdminSection title="Branch Management" description="Quản lý danh sách chi nhánh và trạng thái hoạt động.">
      {admin.hasPermission("BRANCH_MANAGE") ? (
        <form className="grid gap-3 border-b border-border pb-4 md:grid-cols-4" onSubmit={submit}>
          <input className={inputClass} placeholder="Code" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} />
          <input className={inputClass} placeholder="Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <input className={inputClass} placeholder="Timezone" value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} />
          <ActionButton type="submit">Create Branch</ActionButton>
        </form>
      ) : null}
      <QueryState isLoading={branchesQuery.isLoading} error={branchesQuery.error} empty={(branchesQuery.data ?? []).length === 0} />
      <div className="grid gap-3">
        {(branchesQuery.data ?? []).map((branch) => (
          <article key={branch.id} className="rounded-md border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">{branch.code} - {branch.name}</h2>
                <p className="text-sm text-muted-foreground">{branch.timezone}</p>
              </div>
              {admin.hasPermission("BRANCH_MANAGE") ? (
                <select className={inputClass} value={branch.status} onChange={(event) => updateMutation.mutate({ branch, status: event.target.value as Branch["status"] })}>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                </select>
              ) : (
                <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">{branch.status}</span>
              )}
            </div>
          </article>
        ))}
      </div>
    </AdminSection>
  );
}

export function RoleManagementPage(): ReactElement {
  const admin = useAdminContext();
  const queryClient = useQueryClient();
  const context = useMemo(() => ({ accessToken: admin.accessToken, branchId: admin.activeBranchId }), [admin.accessToken, admin.activeBranchId]);
  const [form, setForm] = useState({ code: "", name: "", description: "" });
  const [selectedRoleId, setSelectedRoleId] = useState<string>("");
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<string[]>([]);
  const rolesQuery = useQuery({ queryKey: ["roles", context], queryFn: () => listRoles(context), enabled: admin.hasPermission("ROLE_READ") });
  const permissionsQuery = useQuery({ queryKey: ["permissions", context], queryFn: () => listPermissions(context), enabled: admin.hasPermission("ROLE_READ") });
  const selectedRole = rolesQuery.data?.find((role) => role.id === selectedRoleId) ?? rolesQuery.data?.[0] ?? null;
  const effectivePermissionIds = selectedRoleId ? selectedPermissionIds : (selectedRole?.permissions.map((permission) => permission.id) ?? []);

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ["roles"] });
  };
  const createMutation = useMutation({ mutationFn: () => createRole(context, form), onSuccess: refresh });
  const updateMutation = useMutation({
    mutationFn: ({ role, name, description }: { role: Role; name: string; description: string }) => updateRole(context, role.id, { name, description }),
    onSuccess: refresh
  });
  const replaceMutation = useMutation({
    mutationFn: () => replaceRolePermissions(context, selectedRole?.id ?? "", effectivePermissionIds),
    onSuccess: refresh
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (admin.hasPermission("ROLE_MANAGE")) {
      createMutation.mutate();
      setForm({ code: "", name: "", description: "" });
    }
  }

  function togglePermission(permission: Permission): void {
    if (!selectedRole) {
      return;
    }
    setSelectedRoleId(selectedRole.id);
    setSelectedPermissionIds((current) => {
      const base = selectedRoleId ? current : effectivePermissionIds;
      return base.includes(permission.id) ? base.filter((id) => id !== permission.id) : [...base, permission.id];
    });
  }

  function editRole(role: Role): void {
    const name = window.prompt("Tên role", role.name);
    if (!name?.trim()) {
      return;
    }
    const description = window.prompt("Mô tả role", role.description ?? "") ?? "";
    updateMutation.mutate({ role, name: name.trim(), description: description.trim() });
  }

  if (!admin.hasPermission("ROLE_READ")) {
    return <ForbiddenPanel />;
  }

  return (
    <AdminSection title="Role Management" description="Quản lý role và permission matrix cho staff.">
      {admin.hasPermission("ROLE_MANAGE") ? (
        <form className="grid gap-3 border-b border-border pb-4 md:grid-cols-4" onSubmit={submit}>
          <input className={inputClass} placeholder="Code" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} />
          <input className={inputClass} placeholder="Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <input className={inputClass} placeholder="Description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          <ActionButton type="submit">Create Role</ActionButton>
        </form>
      ) : null}
      <QueryState isLoading={rolesQuery.isLoading || permissionsQuery.isLoading} error={rolesQuery.error ?? permissionsQuery.error} empty={(rolesQuery.data ?? []).length === 0} />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="grid content-start gap-2">
          {(rolesQuery.data ?? []).map((role) => (
            <button key={role.id} className={`rounded-md border border-border px-3 py-2 text-left text-sm ${selectedRole?.id === role.id ? "bg-muted" : ""}`} type="button" onClick={() => {
              setSelectedRoleId(role.id);
              setSelectedPermissionIds(role.permissions.map((permission) => permission.id));
            }}>
              <span className="block font-medium">{role.code}</span>
              <span className="block text-xs text-muted-foreground">{role.isSystem ? "System" : "Custom"}</span>
            </button>
          ))}
        </div>
        {selectedRole ? (
          <section className="rounded-md border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">{selectedRole.name}</h2>
                <p className="text-sm text-muted-foreground">{selectedRole.description ?? "No description"}</p>
              </div>
              {admin.hasPermission("ROLE_MANAGE") ? (
                <div className="flex flex-wrap gap-2">
                  <ActionButton onClick={() => editRole(selectedRole)}>Edit Role</ActionButton>
                  <ActionButton onClick={() => replaceMutation.mutate()} disabled={selectedRole.code === "ADMIN"}>
                    Save Permissions
                  </ActionButton>
                </div>
              ) : null}
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(permissionsQuery.data ?? []).map((permission) => (
                <label key={permission.id} className="flex min-h-10 items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                  <input type="checkbox" checked={effectivePermissionIds.includes(permission.id)} disabled={!admin.hasPermission("ROLE_MANAGE") || selectedRole.code === "ADMIN"} onChange={() => togglePermission(permission)} />
                  <span>{permission.code}</span>
                </label>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </AdminSection>
  );
}

function AdminSection({ title, description, children }: { title: string; description: string; children: ReactNode }): ReactElement {
  return (
    <section className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function QueryState({ isLoading, error, empty }: { isLoading: boolean; error: unknown; empty: boolean }): ReactElement | null {
  if (isLoading) {
    return <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">Đang tải dữ liệu...</p>;
  }
  if (error) {
    return <p className="rounded-md border border-border p-4 text-sm text-red-600">{error instanceof ApiClientError ? error.message : "Không tải được dữ liệu."}</p>;
  }
  if (empty) {
    return <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">Chưa có dữ liệu phù hợp.</p>;
  }
  return null;
}

function ForbiddenPanel(): ReactElement {
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="rounded-md border border-border p-4">
        <h1 className="text-lg font-semibold">Không có quyền truy cập</h1>
        <p className="mt-1 text-sm text-muted-foreground">Tài khoản hiện tại không có permission cho màn hình này.</p>
      </div>
    </section>
  );
}

function ActionButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>): ReactElement {
  return (
    <button
      {...props}
      className={`inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 ${props.className ?? ""}`}
    />
  );
}

const inputClass = "h-9 rounded-md border border-border bg-background px-3 text-sm";
