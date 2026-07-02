"use client";

import { useState } from "react";
import type { Product, Movement, Warehouse } from "@/types/product";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  ArrowLeftRight,
  TrendingUp,
  TrendingDown,
  ArrowRightLeft,
  Save,
  Calendar,
  Filter,
} from "lucide-react";
import { toast } from "sonner";

interface MovementsProps {
  products: Product[];
  movements: Movement[];
  warehouses: Warehouse[];
  onAddMovement: (movement: Omit<Movement, "id" | "createdAt">) => Promise<void>;
}

type MovementType = "entrada" | "salida" | "transferencia";

export function Movements({ products, movements, warehouses, onAddMovement }: MovementsProps) {
  const [activeTab, setActiveTab] = useState<MovementType>("entrada");
  const [loading, setLoading] = useState(false);
  const [filterDate, setFilterDate] = useState("");
  const [filterType, setFilterType] = useState<MovementType | "all">("all");

  // Form state
  const [formData, setFormData] = useState({
    productoId: "",
    cantidad: "",
    motivo: "",
    almacenOrigen: "",
    almacenDestino: "",
    fecha: new Date().toISOString().split("T")[0],
  });

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const resetForm = () => {
    setFormData({
      productoId: "",
      cantidad: "",
      motivo: "",
      almacenOrigen: "",
      almacenDestino: "",
      fecha: new Date().toISOString().split("T")[0],
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const product = products.find((p) => p.id === formData.productoId);
    if (!product) {
      toast.error("Seleccione un producto");
      return;
    }

    const cantidad = Number(formData.cantidad);
    if (!cantidad || cantidad <= 0) {
      toast.error("Ingrese una cantidad válida");
      return;
    }

    // Validar stock para salidas
    if (activeTab === "salida" && cantidad > product.stockActual) {
      toast.error(`Stock insuficiente. Disponible: ${product.stockActual}`);
      return;
    }

    if (activeTab === "transferencia" && (!formData.almacenOrigen || !formData.almacenDestino)) {
      toast.error("Seleccione almacén origen y destino");
      return;
    }

    setLoading(true);
    try {
      await onAddMovement({
        tipo: activeTab,
        productoId: product.id,
        productoNombre: product.nombre,
        productoCodigo: product.codigo,
        cantidad,
        motivo: formData.motivo || getDefaultMotivo(activeTab),
        almacenOrigen: formData.almacenOrigen || undefined,
        almacenDestino: formData.almacenDestino || undefined,
        fecha: new Date(formData.fecha),
      });
      toast.success(`${activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} registrada exitosamente`);
      resetForm();
    } catch {
      toast.error("Error al registrar el movimiento");
    } finally {
      setLoading(false);
    }
  };

  const getDefaultMotivo = (type: MovementType) => {
    switch (type) {
      case "entrada":
        return "Compra de inventario";
      case "salida":
        return "Venta";
      case "transferencia":
        return "Transferencia entre almacenes";
    }
  };

  // Filtrar movimientos
  const filteredMovements = movements.filter((m) => {
    if (filterType !== "all" && m.tipo !== filterType) return false;
    if (filterDate) {
      const movDate = new Date(m.fecha).toISOString().split("T")[0];
      if (movDate !== filterDate) return false;
    }
    return true;
  });

  const getTypeIcon = (type: MovementType) => {
    switch (type) {
      case "entrada":
        return <TrendingUp className="h-4 w-4" />;
      case "salida":
        return <TrendingDown className="h-4 w-4" />;
      case "transferencia":
        return <ArrowRightLeft className="h-4 w-4" />;
    }
  };

  const getTypeBadge = (type: MovementType) => {
    switch (type) {
      case "entrada":
        return <Badge className="bg-chart-2/20 text-chart-2 hover:bg-chart-2/30">Entrada</Badge>;
      case "salida":
        return <Badge className="bg-chart-3/20 text-chart-3 hover:bg-chart-3/30">Salida</Badge>;
      case "transferencia":
        return <Badge className="bg-primary/20 text-primary hover:bg-primary/30">Transferencia</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Movimientos</h1>
        <p className="text-muted-foreground">Registra entradas, salidas y transferencias de productos</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Formulario de Movimiento */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-foreground">
              <ArrowLeftRight className="h-5 w-5 text-primary" />
              Nuevo Movimiento
            </CardTitle>
            <CardDescription>Seleccione el tipo de movimiento a registrar</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as MovementType)}>
              <TabsList className="grid w-full grid-cols-3 mb-6">
                <TabsTrigger value="entrada" className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Entrada
                </TabsTrigger>
                <TabsTrigger value="salida" className="flex items-center gap-2">
                  <TrendingDown className="h-4 w-4" />
                  Salida
                </TabsTrigger>
                <TabsTrigger value="transferencia" className="flex items-center gap-2">
                  <ArrowRightLeft className="h-4 w-4" />
                  Transferencia
                </TabsTrigger>
              </TabsList>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Producto */}
                <div className="space-y-2">
                  <Label>
                    Producto <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={formData.productoId}
                    onValueChange={(v) => handleChange("productoId", v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccione producto" />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          <span className="font-mono text-xs text-muted-foreground mr-2">
                            {p.codigo}
                          </span>
                          {p.nombre}
                          <span className="text-muted-foreground ml-2">
                            (Stock: {p.stockActual})
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Cantidad y Fecha */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>
                      Cantidad <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      type="number"
                      min="1"
                      placeholder="0"
                      value={formData.cantidad}
                      onChange={(e) => handleChange("cantidad", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Fecha</Label>
                    <Input
                      type="date"
                      value={formData.fecha}
                      onChange={(e) => handleChange("fecha", e.target.value)}
                    />
                  </div>
                </div>

                {/* Almacenes (solo para transferencia) */}
                <TabsContent value="transferencia" className="mt-0 space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>
                        Almacén Origen <span className="text-destructive">*</span>
                      </Label>
                      <Select
                        value={formData.almacenOrigen}
                        onValueChange={(v) => handleChange("almacenOrigen", v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccione origen" />
                        </SelectTrigger>
                        <SelectContent>
                          {warehouses.map((w) => (
                            <SelectItem key={w.id} value={w.nombre}>
                              {w.nombre}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>
                        Almacén Destino <span className="text-destructive">*</span>
                      </Label>
                      <Select
                        value={formData.almacenDestino}
                        onValueChange={(v) => handleChange("almacenDestino", v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccione destino" />
                        </SelectTrigger>
                        <SelectContent>
                          {warehouses
                            .filter((w) => w.nombre !== formData.almacenOrigen)
                            .map((w) => (
                              <SelectItem key={w.id} value={w.nombre}>
                                {w.nombre}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </TabsContent>

                {/* Motivo */}
                <div className="space-y-2">
                  <Label>Motivo / Observación</Label>
                  <Input
                    placeholder={getDefaultMotivo(activeTab)}
                    value={formData.motivo}
                    onChange={(e) => handleChange("motivo", e.target.value)}
                  />
                </div>

                <Button type="submit" disabled={loading} className="w-full">
                  <Save className="h-4 w-4 mr-2" />
                  {loading ? "Registrando..." : "Registrar Movimiento"}
                </Button>
              </form>
            </Tabs>
          </CardContent>
        </Card>

        {/* Historial de Movimientos */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-foreground">
              <Calendar className="h-5 w-5 text-primary" />
              Historial de Movimientos
            </CardTitle>
            <CardDescription>Registro de todos los movimientos</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Filtros */}
            <div className="flex gap-3 items-center">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select
                value={filterType}
                onValueChange={(v) => setFilterType(v as MovementType | "all")}
              >
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="entrada">Entradas</SelectItem>
                  <SelectItem value="salida">Salidas</SelectItem>
                  <SelectItem value="transferencia">Transferencias</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="date"
                className="w-40"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
              />
              {filterDate && (
                <Button variant="ghost" size="sm" onClick={() => setFilterDate("")}>
                  Limpiar
                </Button>
              )}
            </div>

            {/* Tabla */}
            <div className="rounded-lg border max-h-96 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Cantidad</TableHead>
                    <TableHead>Fecha</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMovements.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                        No hay movimientos registrados
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredMovements.slice(0, 20).map((m) => (
                      <TableRow key={m.id}>
                        <TableCell>{getTypeBadge(m.tipo)}</TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium text-foreground">{m.productoNombre}</p>
                            <p className="text-xs text-muted-foreground">{m.motivo}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <span
                            className={`font-medium ${
                              m.tipo === "entrada" ? "text-chart-2" : m.tipo === "salida" ? "text-chart-3" : "text-primary"
                            }`}
                          >
                            {m.tipo === "entrada" ? "+" : m.tipo === "salida" ? "-" : ""}
                            {m.cantidad}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(m.fecha).toLocaleDateString("es-MX")}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
