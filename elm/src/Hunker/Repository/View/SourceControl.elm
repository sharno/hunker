module Hunker.Repository.View.SourceControl exposing (Config, view)

import Html exposing (Html, button, label, option, section, select, span, text)
import Html.Attributes exposing (attribute, class, disabled, selected, type_, value)
import Html.Events exposing (onClick, onInput)
import Hunker.ApiError as ApiError
import Hunker.Domain.Repository exposing (Checkout(..))
import Hunker.Repository.SourceControl as SourceControl


type alias Config msg =
    { state : Maybe SourceControl.State
    , selectedBranch : String -> msg
    , requestedRefresh : msg
    , requestedPull : msg
    }


view : Config msg -> Html msg
view config =
    case config.state of
        Just (SourceControl.Loading _) ->
            section [ class "repository-source-control", attribute "role" "status" ]
                [ span [ class "source-control-loading" ] [ text "Reading Git state…" ] ]

        Just (SourceControl.Unavailable _ error) ->
            section [ class "repository-source-control" ]
                [ span [ class "source-control-feedback is-error", attribute "role" "alert" ] [ text (ApiError.message error) ]
                , button [ type_ "button", onClick config.requestedRefresh ] [ text "Retry" ]
                ]

        Just (SourceControl.Ready source) ->
            readyView config source

        Nothing ->
            text ""


readyView : Config msg -> SourceControl.Snapshot -> Html msg
readyView config source =
    let
        status =
            source.status

        branchState =
            case status.checkout of
                TrackingBranch checkout ->
                    { branch = checkout.name, ahead = checkout.ahead, behind = checkout.behind, canPull = checkout.behind > 0 }

                UntrackedBranch checkout ->
                    { branch = checkout.name, ahead = 0, behind = 0, canPull = False }

                DetachedHead _ ->
                    { branch = "", ahead = 0, behind = 0, canPull = False }

        busy =
            SourceControl.busy source.activity
    in
    section [ class "repository-source-control" ]
        [ label [ class "source-control-branch" ]
            [ span [] [ text "Branch" ]
            , select [ value branchState.branch, disabled busy, attribute "aria-label" "Checked-out repository branch", onInput config.selectedBranch ]
                ((case status.checkout of
                    DetachedHead checkout ->
                        [ option [ value "" ] [ text ("Detached at " ++ String.left 7 checkout.oid) ] ]

                    _ ->
                        []
                 )
                    ++ List.map
                        (\candidate ->
                            option [ value candidate.name, selected (candidate.name == branchState.branch) ]
                                [ text
                                    (candidate.name
                                        ++ (if candidate.local then
                                                ""

                                            else
                                                " · remote"
                                           )
                                    )
                                ]
                        )
                        status.branches
                )
            ]
        , if branchState.ahead > 0 then
            span [ class "source-control-count is-ahead" ] [ text (String.fromInt branchState.ahead ++ " ↑") ]

          else
            text ""
        , if branchState.behind > 0 then
            span [ class "source-control-count is-behind" ] [ text (String.fromInt branchState.behind ++ " ↓") ]

          else
            text ""
        , span [ class "source-control-changes" ]
            [ text
                (String.fromInt status.staged
                    ++ " staged · "
                    ++ String.fromInt status.unstaged
                    ++ " changed · "
                    ++ String.fromInt status.untracked
                    ++ " untracked"
                )
            ]
        , feedback source.activity status.path
        , button
            [ type_ "button", class "source-control-refresh", disabled busy, attribute "aria-label" "Refresh repository source control", onClick config.requestedRefresh ]
            [ text "↻" ]
        , button [ type_ "button", class "source-control-pull", disabled (busy || not branchState.canPull), onClick config.requestedPull ]
            [ text
                (case source.activity of
                    SourceControl.PullInFlight ->
                        "Pulling…"

                    SourceControl.PullSynchronizing count ->
                        SourceControl.pulledMessage count ++ " Refreshing status…"

                    _ ->
                        if branchState.behind > 0 then
                            "Pull " ++ String.fromInt branchState.behind ++ " ↓"

                        else
                            "Up to date"
                )
            ]
        ]


feedback : SourceControl.Activity -> String -> Html msg
feedback action path =
    case action of
        SourceControl.Succeeded message ->
            span [ class "source-control-feedback is-success" ] [ text message ]

        _ ->
            span [ class "source-control-path" ] [ text path ]
