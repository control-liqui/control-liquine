"use client";

import type { Product, Movement } from "@/types/product";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Package,
  ArrowLeftRight,
  DollarSign,
  AlertTriangle,
  XCircle,
  TrendingUp,
  TrendingDown,
} from "lucide-react";

interface DashboardProps {
  products: Product[];
  movements: Movement[];
  loading: boolean;
}

export function Dashboard({ products, movements, loading }: DashboardProps) {
  const totalProducts = products.length;
  const totalMovements = movements.length;
  const totalValue = products.reduce((acc, p) => acc + p.stockActual * p.precio, 0);
  const lowStockProducts = products.filter((p) => p.stockActual > 0 && p.stockActual <= p.stockMinimo);
  const outOfStockProducts = products.filter((p) => p.stockActual === 0);

  // Movimientos recientes (últimos 7 días)
  const recentMovements = movements.slice(0, 10);

  // Calcular entradas y salidas del día
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMovements = movements.filter((m) => new Date(m.fecha) >= today);
  const todayEntries = todayMovements.filter((m) => m.tipo === "entrada").reduce((acc, m) => acc + m.cantidad, 0);
  const todayExits = todayMovements.filter((m) => m.tipo === "salida").reduce((acc, m) => acc + m.cantidad, 0);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground">Resumen general del inventario</p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card className="border-l-4 border-l-primary">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Productos</CardTitle>
            <Package className="h-5 w-5 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">{totalProducts}</div>
            <p className="text-xs text-muted-foreground mt-1">Productos registrados</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-chart-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Movimientos</CardTitle>
            <ArrowLeftRight className="h-5 w-5 text-chart-2" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">{totalMovements}</div>
            <p className="text-xs text-muted-foreground mt-1">Movimientos registrados</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-chart-4">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Valor Total</CardTitle>
            <DollarSign className="h-5 w-5 text-chart-4" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">
              ${totalValue.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Valor del inventario</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-warning">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Stock Bajo</CardTitle>
            <AlertTriangle className="h-5 w-5 text-warning" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">{lowStockProducts.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Productos con stock bajo</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-destructive">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Sin Stock</CardTitle>
            <XCircle className="h-5 w-5 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">{outOfStockProducts.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Productos agotados</p>
          </CardContent>
        </Card>
      </div>

      {/* Second Row - Today's Activity */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Entradas Hoy</CardTitle>
            <TrendingUp className="h-5 w-5 text-chart-2" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-chart-2">+{todayEntries}</div>
            <p className="text-xs text-muted-foreground mt-1">Unidades ingresadas</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Salidas Hoy</CardTitle>
            <TrendingDown className="h-5 w-5 text-chart-3" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-chart-3">-{todayExits}</div>
            <p className="text-xs text-muted-foreground mt-1">Unidades salientes</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Movimientos Hoy</CardTitle>
            <ArrowLeftRight className="h-5 w-5 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{todayMovements.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Operaciones realizadas</p>
          </CardContent>
        </Card>
      </div>

      {/* Bottom Section - Alerts and Recent Activity */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Low Stock Alerts */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-foreground">
              <AlertTriangle className="h-5 w-5 text-warning" />
              Alertas de Stock
            </CardTitle>
          </CardHeader>
          <CardContent>
            {lowStockProducts.length === 0 && outOfStockProducts.length === 0 ? (
              <p className="text-muted-foreground text-sm">No hay alertas de stock</p>
            ) : (
              <div className="space-y-3 max-h-64 overflow-auto">
                {outOfStockProducts.map((product) => (
                  <div
                    key={product.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-destructive/10 border border-destructive/20"
                  >
                    <div>
                      <p className="font-medium text-foreground">{product.nombre}</p>
                      <p className="text-xs text-muted-foreground">{product.codigo}</p>
                    </div>
                    <span className="text-sm font-medium text-destructive">Sin stock</span>
                  </div>
                ))}
                {lowStockProducts.map((product) => (
                  <div
                    key={product.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-warning/10 border border-warning/20"
                  >
                    <div>
                      <p className="font-medium text-foreground">{product.nombre}</p>
                      <p className="text-xs text-muted-foreground">{product.codigo}</p>
                    </div>
                    <span className="text-sm font-medium text-warning-foreground">
                      {product.stockActual} / {product.stockMinimo}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Movements */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-foreground">
              <ArrowLeftRight className="h-5 w-5 text-primary" />
              Movimientos Recientes
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentMovements.length === 0 ? (
              <p className="text-muted-foreground text-sm">No hay movimientos registrados</p>
            ) : (
              <div className="space-y-3 max-h-64 overflow-auto">
                {recentMovements.map((movement) => (
                  <div
                    key={movement.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`h-8 w-8 rounded-full flex items-center justify-center ${
                          movement.tipo === "entrada"
                            ? "bg-chart-2/20 text-chart-2"
                            : movement.tipo === "salida"
                            ? "bg-chart-3/20 text-chart-3"
                            : "bg-primary/20 text-primary"
                        }`}
                      >
                        {movement.tipo === "entrada" ? (
                          <TrendingUp className="h-4 w-4" />
                        ) : movement.tipo === "salida" ? (
                          <TrendingDown className="h-4 w-4" />
                        ) : (
                          <ArrowLeftRight className="h-4 w-4" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-sm text-foreground">{movement.productoNombre}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(movement.fecha).toLocaleDateString("es-MX")}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`font-medium ${
                        movement.tipo === "entrada" ? "text-chart-2" : "text-chart-3"
                      }`}
                    >
                      {movement.tipo === "entrada" ? "+" : "-"}
                      {movement.cantidad}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
