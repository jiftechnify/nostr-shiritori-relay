FROM public.ecr.aws/docker/library/golang:1.25.5-alpine AS build
WORKDIR /go/src
COPY . /go/src
RUN apk --update --no-cache add ca-certificates
RUN CGO_ENABLED=0 go build -o /go/bin/yomi-api -ldflags '-extldflags "-static"' -tags timetzdata

FROM scratch
COPY --from=build /go/bin/yomi-api /yomi-api
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
EXPOSE 8080
ENTRYPOINT [ "/yomi-api" ]
