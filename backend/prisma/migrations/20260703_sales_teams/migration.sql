-- C4: Equipos de ventas. Solo backend — UI super admin viene en este
-- mismo commit, pero el feature de "lead ve métricas agregadas del
-- equipo" se posterga a C8.

CREATE TABLE "SalesTeam" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "leadUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SalesTeam_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SalesTeam_leadUserId_idx" ON "SalesTeam"("leadUserId");

ALTER TABLE "SalesTeam"
  ADD CONSTRAINT "SalesTeam_leadUserId_fkey"
  FOREIGN KEY ("leadUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SalesTeamMember" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SalesTeamMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalesTeamMember_teamId_userId_key"
  ON "SalesTeamMember"("teamId", "userId");
CREATE INDEX "SalesTeamMember_userId_idx" ON "SalesTeamMember"("userId");

ALTER TABLE "SalesTeamMember"
  ADD CONSTRAINT "SalesTeamMember_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "SalesTeam"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SalesTeamMember"
  ADD CONSTRAINT "SalesTeamMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
