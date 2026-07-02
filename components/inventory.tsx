"use client";

import { useState } from "react";
import type { Product, UnitOfMeasure, ProductGroup } from "@/types/product";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Boxes, Search, Edit2, Trash2, Save, Filter } from "lucide-react";
import { toast } from "sonner";

interface InventoryProps {
  products: Product[];
  units: UnitOfMeasure[];
  groups: ProductGroup[];
  onUpdate: (id: string, product: Partial<Product>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function Inventory({ products, units, groups, onUpdate, onDelete }: InventoryProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterGroup, setFilterGroup] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(false);

  // Edit form state
  const [editForm, setEditForm] = useState({
    codigo: "",
    nombre: "",
    unidadMedida: "",
    grupo: "",
    stockMinimo: "",
    stockActual: "",
    precio: "",
  });

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setEditForm({
      codigo: product.codigo,
      nombre: product.nombre,
      unidadMedida: product.unidadMedida,
      grupo: product.grupo,
      stockMinimo: String(product.stockMinimo),
      stockActual: String(product.stockActual),
      precio: String(product.precio),
    });
  };

  const handleSaveEdit = async () => {
    if (!editingProduct) return;

    setLoading(true);
    try {
      await onUpdate(editingProduct.id, {
        codigo: editForm.codigo.toUpperCase(),
        nombre: editForm.nombre,
        unidadMedida: editForm.unidadMedida,
        grupo: editForm.grupo,
        stockMinimo: Number(editForm.stockMinimo) || 0,
        stockActual: Number(editForm.stockActual) || 0,
        precio: Number(editForm.precio) || 0,
      });
      toast.success("Producto actualizado exitosamente");
      setEditingProduct(null);
    } catch {
      toast.error("Error al actualizar el producto");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingProduct) return;

    setLoading(true);
    try {
      await onDelete(deletingProduct.id);
      toast.success("Producto eliminado exitosamente");
      setDeletingProduct(null);
    } catch {
      toast.error("Error al eliminar el producto");
    } finally {
      setLoading(false);
    }
  };

  const getStockStatus = (product: Product) => {
    if (product.stockActual === 0) {
      return <Badge variant="destructive">Sin Stock</Badge>;
    }
    if (product.stockActual <= product.stockMinimo) {
      return <Badge className="bg-warning/20 text-warning-foreground hover:bg-warning/30">Stock Bajo</Badge>;
    }
    return <Badge className="bg-chart-2/20 text-chart-2 hover:bg-chart-2/30">Disponible</Badge>;
  };

  // Filtrar productos
  const filteredProducts = products.filter((p) => {
    const matchesSearch =
      p.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.codigo.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesGroup = filterGroup === "all" || p.grupo === filterGroup;
    const matchesStatus =
      filterStatus === "all" ||
      (filterStatus === "disponible" && p.stockActual > p.stockMinimo) ||
      (filterStatus === "bajo" && p.stockActual > 0 && p.stockActual <= p.stockMinimo) ||
      (filterStatus === "sin" && p.stockActual === 0);
    return matchesSearch && matchesGroup && matchesStatus;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Inventario</h1>
        <p className="text-muted-foreground">Gestiona todos los productos del inventario</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Boxes className="h-5 w-5 text-primary" />
            Lista de Productos
          </CardTitle>
          <CardDescription>
            {filteredProducts.length} de {products.length} productos
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filtros */}
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre o código..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={filterGroup} onValueChange={setFilterGroup}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Grupo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los grupos</SelectItem>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.nombre}>
                      {g.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Estado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="disponible">Disponible</SelectItem>
                  <SelectItem value="bajo">Stock Bajo</SelectItem>
                  <SelectItem value="sin">Sin Stock</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Tabla */}
          <div className="rounded-lg border overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Grupo</TableHead>
                  <TableHead>Unidad</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">Precio</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-12">
                      No se encontraron productos
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredProducts.map((product) => (
                    <TableRow key={product.id}>
                      <TableCell className="font-mono text-sm">{product.codigo}</TableCell>
                      <TableCell className="font-medium text-foreground">{product.nombre}</TableCell>
                      <TableCell className="text-muted-foreground">{product.grupo}</TableCell>
                      <TableCell className="text-muted-foreground">{product.unidadMedida}</TableCell>
                      <TableCell className="text-right">
                        <span
                          className={`font-medium ${
                            product.stockActual === 0
                              ? "text-destructive"
                              : product.stockActual <= product.stockMinimo
                              ? "text-warning-foreground"
                              : "text-foreground"
                          }`}
                        >
                          {product.stockActual}
                        </span>
                        <span className="text-muted-foreground text-xs ml-1">
                          / {product.stockMinimo}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-foreground">
                        ${product.precio.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell>{getStockStatus(product)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(product)}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeletingProduct(product)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editingProduct} onOpenChange={() => setEditingProduct(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar Producto</DialogTitle>
            <DialogDescription>
              Modifica la información del producto
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Código</Label>
                <Input
                  value={editForm.codigo}
                  onChange={(e) => setEditForm({ ...editForm, codigo: e.target.value })}
                  className="uppercase"
                />
              </div>
              <div className="space-y-2">
                <Label>Nombre</Label>
                <Input
                  value={editForm.nombre}
                  onChange={(e) => setEditForm({ ...editForm, nombre: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Unidad de Medida</Label>
                <Select
                  value={editForm.unidadMedida}
                  onValueChange={(v) => setEditForm({ ...editForm, unidadMedida: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {units.map((u) => (
                      <SelectItem key={u.id} value={u.nombre}>
                        {u.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Grupo</Label>
                <Select
                  value={editForm.grupo}
                  onValueChange={(v) => setEditForm({ ...editForm, grupo: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={g.nombre}>
                        {g.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Stock Actual</Label>
                <Input
                  type="number"
                  min="0"
                  value={editForm.stockActual}
                  onChange={(e) => setEditForm({ ...editForm, stockActual: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Stock Mínimo</Label>
                <Input
                  type="number"
                  min="0"
                  value={editForm.stockMinimo}
                  onChange={(e) => setEditForm({ ...editForm, stockMinimo: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Precio</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={editForm.precio}
                  onChange={(e) => setEditForm({ ...editForm, precio: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingProduct(null)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveEdit} disabled={loading}>
              <Save className="h-4 w-4 mr-2" />
              {loading ? "Guardando..." : "Guardar Cambios"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deletingProduct} onOpenChange={() => setDeletingProduct(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar Producto</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción eliminará permanentemente el producto{" "}
              <strong>{deletingProduct?.nombre}</strong>. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {loading ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
