"use client";

import { useState } from "react";
import type { Product, UnitOfMeasure, ProductGroup, ViewType } from "@/types/product";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PackagePlus, Save, RotateCcw } from "lucide-react";
import { toast } from "sonner";

interface NewProductProps {
  units: UnitOfMeasure[];
  groups: ProductGroup[];
  onSave: (product: Omit<Product, "id" | "createdAt" | "updatedAt">) => Promise<void>;
  onNavigate: (view: ViewType) => void;
}

export function NewProduct({ units, groups, onSave, onNavigate }: NewProductProps) {
  const [formData, setFormData] = useState({
    codigo: "",
    nombre: "",
    unidadMedida: "",
    grupo: "",
    stockMinimo: "",
    stockActual: "",
    precio: "",
  });
  const [loading, setLoading] = useState(false);

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleReset = () => {
    setFormData({
      codigo: "",
      nombre: "",
      unidadMedida: "",
      grupo: "",
      stockMinimo: "",
      stockActual: "",
      precio: "",
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.codigo || !formData.nombre || !formData.unidadMedida || !formData.grupo) {
      toast.error("Por favor complete todos los campos requeridos");
      return;
    }

    setLoading(true);
    try {
      await onSave({
        codigo: formData.codigo.toUpperCase(),
        nombre: formData.nombre,
        unidadMedida: formData.unidadMedida,
        grupo: formData.grupo,
        stockMinimo: Number(formData.stockMinimo) || 0,
        stockActual: Number(formData.stockActual) || 0,
        precio: Number(formData.precio) || 0,
      });
      toast.success("Producto registrado exitosamente");
      handleReset();
      onNavigate("inventario");
    } catch {
      toast.error("Error al registrar el producto");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Nuevo Producto</h1>
        <p className="text-muted-foreground">Registra un nuevo producto en el inventario</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <PackagePlus className="h-5 w-5 text-primary" />
            Datos del Producto
          </CardTitle>
          <CardDescription>Complete la información del producto a registrar</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Codigo y Nombre */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="codigo">
                  Código <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="codigo"
                  placeholder="Ej: PROD001"
                  value={formData.codigo}
                  onChange={(e) => handleChange("codigo", e.target.value)}
                  className="uppercase"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nombre">
                  Nombre <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="nombre"
                  placeholder="Nombre del producto"
                  value={formData.nombre}
                  onChange={(e) => handleChange("nombre", e.target.value)}
                />
              </div>
            </div>

            {/* Unidad y Grupo */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="unidad">
                  Unidad de Medida <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={formData.unidadMedida}
                  onValueChange={(value) => handleChange("unidadMedida", value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccione unidad" />
                  </SelectTrigger>
                  <SelectContent>
                    {units.map((unit) => (
                      <SelectItem key={unit.id} value={unit.nombre}>
                        {unit.nombre} ({unit.abreviatura})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="grupo">
                  Grupo <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={formData.grupo}
                  onValueChange={(value) => handleChange("grupo", value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccione grupo" />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((group) => (
                      <SelectItem key={group.id} value={group.nombre}>
                        {group.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Stock y Precio */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="stockActual">Stock Inicial</Label>
                <Input
                  id="stockActual"
                  type="number"
                  min="0"
                  placeholder="0"
                  value={formData.stockActual}
                  onChange={(e) => handleChange("stockActual", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="stockMinimo">Stock Mínimo</Label>
                <Input
                  id="stockMinimo"
                  type="number"
                  min="0"
                  placeholder="0"
                  value={formData.stockMinimo}
                  onChange={(e) => handleChange("stockMinimo", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Para alertas de reposición</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="precio">Precio Unitario</Label>
                <Input
                  id="precio"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={formData.precio}
                  onChange={(e) => handleChange("precio", e.target.value)}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-4">
              <Button type="submit" disabled={loading} className="flex-1 sm:flex-none">
                <Save className="h-4 w-4 mr-2" />
                {loading ? "Guardando..." : "Guardar Producto"}
              </Button>
              <Button type="button" variant="outline" onClick={handleReset}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Limpiar
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
